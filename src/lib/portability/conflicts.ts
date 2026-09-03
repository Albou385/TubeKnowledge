import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import yazl from "yazl";

import { sha256 } from "@/lib/imports/hash";
import { previewImport } from "@/lib/imports/preview";
import type { LibraryEnvironment } from "@/lib/config/library-config";
import { atomicWriteJson, windowsPathKey } from "./filesystem";
import { looksLikeConflictCopy } from "./conflict-patterns";
import type { PortabilityConfig } from "./config";
import type { Checkpoint, PortabilityConflict, VaultSnapshot, WriterAuthority } from "./types";
import { applyLegacyWriterConflictAcknowledgements } from "./legacy-writer-conflict";

function deterministicUuid(type: string, paths: string[]): string { const hex = createHash("sha256").update(`${type}\0${paths.join("\0")}`).digest("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`; }
function conflict(type: PortabilityConflict["type"], paths: string[], reason: string, now: Date, checkpoint?: Checkpoint, severity: PortabilityConflict["severity"] = "blocking"): PortabilityConflict { return { schemaVersion: 1, conflictId: deterministicUuid(type, paths), type, detectedAt: now.toISOString(), paths, baseCheckpointId: checkpoint?.checkpointId, severity, status: "open", evidence: { reason } }; }

export function isTechnicalWriterConflict(item: PortabilityConflict): boolean {
  return item.type === "stale-writer-authority";
}

export function isBlockingKnowledgeConflict(item: PortabilityConflict): boolean {
  return item.status === "open" && item.severity === "blocking" && !isTechnicalWriterConflict(item);
}

export function describeConflict(item: PortabilityConflict): { category: "knowledge" | "technical"; probableCause: string; impact: string; recommendedAction: string } {
  if (item.type === "stale-writer-authority") return {
    category: "technical",
    probableCause: "Le lease writer est arrivé à expiration; aucun fichier Markdown n’est impliqué.",
    impact: "Le writer ne peut plus écrire tant qu’une réacquisition explicite n’a pas réussi.",
    recommendedAction: "Conserver l’enregistrement historique intact, puis le classer explicitement comme informationnel avant toute récupération si son expiration est confirmée.",
  };
  if (item.type === "checkpoint-mismatch") return {
    category: "knowledge",
    probableCause: "Le rootHash du snapshot de connaissance diffère du checkpoint de référence.",
    impact: "Les écritures writer restent bloquées pour éviter d’écraser une divergence.",
    recommendedAction: "Comparer les connaissances et préparer toute correction via Preview/Apply Phase 3.",
  };
  return {
    category: "knowledge",
    probableCause: item.evidence.reason,
    impact: item.severity === "blocking" ? "Les écritures sensibles sont bloquées." : "Une vérification humaine est recommandée.",
    recommendedAction: "Examiner les chemins relatifs et utiliser Preview/Apply Phase 3 pour toute modification de connaissance.",
  };
}

export async function detectConflicts(snapshot: VaultSnapshot, config: PortabilityConfig, checkpoint: Checkpoint | null, options: { now?: Date; placeholderPaths?: string[]; baseSnapshot?: VaultSnapshot; writerAuthority?: WriterAuthority | null } = {}): Promise<PortabilityConflict[]> {
  const now = options.now || new Date(); const results: PortabilityConflict[] = []; const caseGroups = new Map<string, string[]>();
  for (const file of snapshot.files) { const key = windowsPathKey(file.path); caseGroups.set(key, [...(caseGroups.get(key) || []), file.path]); if (looksLikeConflictCopy(file.path)) results.push(conflict("onedrive-conflict-copy", [file.path], "Le nom ressemble prudemment à une copie de conflit OneDrive.", now, checkpoint ?? undefined)); }
  for (const paths of caseGroups.values()) if (paths.length > 1) results.push(conflict("case-collision", paths, "Plusieurs chemins ne diffèrent que par la casse Windows.", now, checkpoint ?? undefined));
  for (const relativePath of options.placeholderPaths || []) results.push(conflict("incomplete-placeholder", [relativePath], "Le contenu local n’est pas hydraté.", now, checkpoint ?? undefined));
  const hashes = new Map<string, string[]>(); for (const file of snapshot.files) hashes.set(file.sha256, [...(hashes.get(file.sha256) || []), file.path]); for (const paths of hashes.values()) if (paths.length > 1) results.push(conflict("duplicate-suspected", paths, "Plusieurs fichiers distincts ont un contenu SHA-256 identique.", now, checkpoint ?? undefined, "warning"));
  if (options.baseSnapshot) {
    const current = new Map(snapshot.files.map((file) => [windowsPathKey(file.path), file])); const base = new Map(options.baseSnapshot.files.map((file) => [windowsPathKey(file.path), file]));
    for (const [key, before] of base) { const after = current.get(key); if (!after) results.push(conflict("deleted-vs-modified", [before.path], "Un fichier du snapshot local précédent a disparu.", now, checkpoint ?? undefined)); else if (after.sha256 !== before.sha256) results.push(conflict("content-divergence", [after.path], "Le contenu diffère du snapshot local précédent.", now, checkpoint ?? undefined)); }
    for (const [key, after] of current) if (!base.has(key) && (after.path.startsWith("00_SYSTEME/") || !/^(?:INDEX\.md|00_SYSTEME\/|01_BIBLIOTHEQUE\/|02_SOURCES\/|03_A_TRAITER\/)/.test(after.path))) results.push(conflict("unexpected-system-change", [after.path], "Un fichier système ou hors taxonomie est apparu.", now, checkpoint ?? undefined));
  }
  // L’expiration writer appartient au modèle de cycle de vie et non aux conflits de connaissance.
  // Le type historique reste lisible pour diagnostiquer les enregistrements V1 déjà présents.
  if (checkpoint && checkpoint.rootHash !== snapshot.rootHash) results.push(conflict("checkpoint-mismatch", [], "Le rootHash local diffère du dernier checkpoint partagé.", now, checkpoint));
  await atomicWriteJson(path.join(config.statePath, "conflicts.json"), results); return results;
}

async function loadRawConflicts(config: PortabilityConfig): Promise<PortabilityConflict[]> { try { return JSON.parse(await readFile(path.join(config.statePath, "conflicts.json"), "utf8")) as PortabilityConflict[]; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; } }
export async function loadConflicts(config: PortabilityConfig): Promise<PortabilityConflict[]> { return applyLegacyWriterConflictAcknowledgements(config, await loadRawConflicts(config)); }
export async function classifyConflict(config: PortabilityConfig, conflictId: string, status: "resolved" | "false-positive"): Promise<PortabilityConflict> { const values = await loadRawConflicts(config); const item = values.find((value) => value.conflictId === conflictId); if (!item) throw new Error("Conflit inconnu."); const updated = { ...item, status }; await atomicWriteJson(path.join(config.statePath, "conflicts.json"), values.map((value) => value.conflictId === conflictId ? updated : value)); return updated; }

function zipBuffer(files: Array<{ name: string; content: string }>): Promise<Buffer> { const zip = new yazl.ZipFile(); for (const file of files) zip.addBuffer(Buffer.from(file.content, "utf8"), file.name); zip.end(); const chunks: Buffer[] = []; return new Promise((resolve, reject) => { zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk)); zip.outputStream.once("error", reject); zip.outputStream.once("end", () => resolve(Buffer.concat(chunks))); }); }

export async function previewConflictResolution(input: { conflictId: string; targetPath: string; content: string; sourceTitle?: string }, config: PortabilityConfig, environment: LibraryEnvironment, sessionRoot?: string) {
  const conflicts = await loadConflicts(config); const item = conflicts.find((value) => value.conflictId === input.conflictId && value.status === "open"); if (!item) throw new Error("Conflit ouvert inconnu.");
  const libraryPath = environment.YOUTUBE_LIBRARY_PATH; if (!libraryPath) throw new Error("Vault absent."); const current = await readFile(path.join(libraryPath, ...input.targetPath.split("/")), "utf8");
  const packageId = randomUUID(); const contentFile = `changes/replace/${input.targetPath}`; const manifest = { schemaVersion: 1, packageId, generatedAt: new Date().toISOString(), source: { type: "manual-notes", title: input.sourceTitle || "Résolution de conflit Phase 6", url: "https://example.invalid/tubeknowledge-portability-conflict" }, summary: "Résolution contrôlée d’un conflit Phase 6 via Preview Phase 3.", structuralChange: { level: "major", confirmationRequired: true, summary: "Résolution de conflit contrôlée." }, operations: [{ type: "replace", path: input.targetPath, contentFile, expectedSha256: sha256(current), newSha256: sha256(input.content) }] };
  const zip = await zipBuffer([{ name: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` }, { name: "REVIEW.md", content: "# Résolution de conflit\n\nVérifiez intégralement le diff avant Apply.\n" }, { name: contentFile, content: input.content }]);
  return previewImport(zip, { environment, sessionRoot, origin: { type: "portability-conflict", conflictId: input.conflictId } });
}

import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { prevalidateChatGptResult } from "../src/lib/chatgpt-packages/result";
import { loadStoredPackage } from "../src/lib/chatgpt-packages/runtime";
import { applyImport } from "../src/lib/imports/apply";
import { readImportHistory } from "../src/lib/imports/history";
import { resumeImportPreview } from "../src/lib/imports/preview";
import { loadWorkflow } from "../src/lib/workflows/runtime";

const PACKAGE_ID = "573310e0-7871-4e10-a433-d560e028a348";
const WORKFLOW_ID = "18fb940b-fc0e-4ccd-87e4-59eacec6c172";
const EXPECTED_PATHS = [
  "01_BIBLIOTHEQUE/Productivite/INDEX.md",
  "01_BIBLIOTHEQUE/Productivite/Gestion-des-connaissances-personnelles/INDEX.md",
  "01_BIBLIOTHEQUE/Productivite/Gestion-des-connaissances-personnelles/systeme-de-notes-local-first-et-reliees.md",
  "01_BIBLIOTHEQUE/Productivite/Gestion-des-connaissances-personnelles/organiser-un-vault-obsidian-progressivement.md",
  "02_SOURCES/videos.md",
] as const;

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} doit fournir un chemin absolu.`);
  return path.normalize(value);
}

async function copyRegularTree(source: string, target: string, markdownOnly = false): Promise<void> {
  const details = await lstat(source);
  if (details.isSymbolicLink()) throw new Error("Lien symbolique interdit dans la source de contrôle.");
  if (details.isFile()) {
    if (!markdownOnly || source.toLowerCase().endsWith(".md")) {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    return;
  }
  if (!details.isDirectory()) return;
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if ([".backups", ".tubeknowledge", ".git"].includes(entry.name)) continue;
    await copyRegularTree(path.join(source, entry.name), path.join(target, entry.name), markdownOnly);
  }
}

async function markdownPaths(root: string): Promise<string[]> {
  const values: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) values.push(path.relative(root, target).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return values.sort((left, right) => left.localeCompare(right, "fr"));
}

async function assertWikiLinks(root: string): Promise<number> {
  const files = await markdownPaths(root);
  const exact = new Set(files.map((value) => value.toLocaleLowerCase("en")));
  const basenames = new Map<string, string[]>();
  for (const file of files) {
    const key = path.posix.basename(file, ".md").toLocaleLowerCase("en");
    basenames.set(key, [...(basenames.get(key) ?? []), file]);
  }
  let checked = 0;
  for (const relativePath of EXPECTED_PATHS.filter((value) => value !== "02_SOURCES/videos.md")) {
    const content = await readFile(path.join(root, ...relativePath.split("/")), "utf8");
    for (const match of content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      const reference = match[1].trim().replaceAll("\\", "/").replace(/^\//, "");
      const withExtension = reference.toLowerCase().endsWith(".md") ? reference : `${reference}.md`;
      const direct = exact.has(withExtension.toLocaleLowerCase("en"));
      const byName = basenames.get(path.posix.basename(reference, ".md").toLocaleLowerCase("en")) ?? [];
      if (!direct && byName.length !== 1) throw new Error(`Lien interne non résolu dans ${relativePath}.`);
      checked += 1;
    }
  }
  return checked;
}

async function main() {
  const sourceVault = argument("--source-vault");
  const sourceRuntime = argument("--source-runtime");
  if (!/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(sourceVault)) throw new Error("La source attendue doit être le vault OneDrive réel en lecture seule.");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "tk-phase10-4-obsidian-copy-"));
  const vault = path.join(temporary, "vault-copy");
  const runtime = path.join(temporary, "runtime-copy");
  const packageRoot = path.join(runtime, "chatgpt-packages");
  const workflowRoot = path.join(runtime, "video-knowledge-workflows");
  const sessions = path.join(temporary, "sessions");
  try {
    await copyRegularTree(sourceVault, vault, true);
    await copyRegularTree(path.join(sourceRuntime, "chatgpt-packages", PACKAGE_ID), path.join(packageRoot, PACKAGE_ID));
    await mkdir(workflowRoot, { recursive: true });
    await copyFile(path.join(sourceRuntime, "video-knowledge-workflows", `${WORKFLOW_ID}.json`), path.join(workflowRoot, `${WORKFLOW_ID}.json`));
    const resultZip = await readFile(path.join(packageRoot, PACKAGE_ID, "result.zip"));
    const environment = { YOUTUBE_LIBRARY_PATH: vault };
    const prevalidation = await prevalidateChatGptResult(PACKAGE_ID, resultZip, { environment, sessionRoot: sessions, runtimeRoot: packageRoot });
    const previewPaths = prevalidation.preview.operations.map((operation) => operation.path);
    if (JSON.stringify(previewPaths) !== JSON.stringify(EXPECTED_PATHS)) throw new Error(`La Preview ne contient pas les cinq chemins attendus: ${previewPaths.join(", ")}`);
    if (!prevalidation.preview.canApply) throw new Error("La Preview Obsidian copiée n’est pas applicable.");

    const applied = await applyImport({ sessionId: prevalidation.preview.sessionId, confirmed: true, confirmationText: "APPLIQUER" }, { environment, sessionRoot: sessions });
    if (applied.status !== "success") throw new Error(`Apply Obsidian échoué: ${applied.message}`);
    for (const relativePath of EXPECTED_PATHS) await stat(path.join(vault, ...relativePath.split("/")));
    for (const relativePath of EXPECTED_PATHS.slice(0, 2)) {
      const content = await readFile(path.join(vault, ...relativePath.split("/")), "utf8");
      if (!content.trim() || content.includes("�")) throw new Error(`Index illisible: ${relativePath}`);
    }
    const internalLinksChecked = await assertWikiLinks(vault);
    const stored = await loadStoredPackage(PACKAGE_ID, packageRoot);
    const videos = await readFile(path.join(vault, "02_SOURCES", "videos.md"), "utf8");
    const urlOccurrences = videos.split(stored.manifest.source.url).length - 1;
    if (urlOccurrences !== 1) throw new Error(`La ligne vidéo attendue n’est pas unique: ${urlOccurrences}.`);
    const history = await readImportHistory(vault);
    if (history.filter((entry) => entry.status === "success").length !== 1) throw new Error("L’historique de succès n’est pas unique.");
    const workflow = await loadWorkflow(WORKFLOW_ID, workflowRoot);
    if (workflow.state !== "imported" || workflow.importId !== applied.importId) throw new Error("Le workflow copié n’est pas finalisé.");
    const resumed = await resumeImportPreview(prevalidation.preview.sessionId, { environment, sessionRoot: sessions });
    if (resumed.appliedResult?.importId !== applied.importId) throw new Error("Le rafraîchissement logique ne retrouve pas le succès.");
    const replay = await applyImport({ sessionId: prevalidation.preview.sessionId, confirmed: true, confirmationText: "APPLIQUER" }, { environment, sessionRoot: sessions });
    if (!replay.idempotent || replay.importId !== applied.importId || replay.backupId !== applied.backupId) throw new Error("Le replay du cas Obsidian n’est pas idempotent.");
    const backups = await readdir(path.join(vault, ".backups", "imports"));
    if (backups.length !== 1) throw new Error("Le replay a créé un backup supplémentaire.");

    const evidence = {
      schemaVersion: 1,
      case: "why I switched to using Obsidian (as a former Notion user)",
      previewPaths,
      previewCanApply: true,
      applyStatus: applied.status,
      created: applied.filesCreated,
      replaced: applied.filesReplaced,
      backupCount: backups.length,
      successHistoryCount: history.filter((entry) => entry.status === "success").length,
      workflowState: workflow.state,
      workflowKnowledgePathCount: workflow.knowledgePaths.length,
      internalLinksChecked,
      videoUrlOccurrences: urlOccurrences,
      refreshRecoveredImport: resumed.appliedResult?.importId === applied.importId,
      replayIdempotent: replay.idempotent,
      temporaryCopyRemoved: true,
    };
    const reportRoot = path.resolve("reports", "phase-10-4-qa");
    await mkdir(reportRoot, { recursive: true });
    await writeFile(path.join(reportRoot, "obsidian-copy-check.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(`[OK] Preview Obsidian: ${previewPaths.length} opérations attendues.`);
    console.log(`[OK] Apply, workflow, liens, vidéo, rafraîchissement et replay idempotent validés sur copie temporaire.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Échec du contrôle Obsidian sur copie.");
  process.exitCode = 1;
});

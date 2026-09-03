import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { generatePackage } from "./builder";
import { prevalidateChatGptResult } from "./result";
import { loadStoredPackage, packageZipPath } from "./runtime";
import { makeChatGptVault, makeCompletedAcquisition } from "./test-utils";
import { applyImport } from "@/lib/imports/apply";
import { sha256 } from "@/lib/imports/hash";
import { makeZip, packageZip, validManifest } from "@/lib/imports/test-utils";

const temporary: string[] = [];
async function temp(prefix: string) { const value = await mkdtemp(path.join(os.tmpdir(), prefix)); temporary.push(value); return value; }
afterEach(async () => { await Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true }))); });

async function fixture(structural = false) {
  const vault = await temp("tk-p5-result-vault-"); const acquisitionRuntime = await temp("tk-p5-result-acq-"); const runtimeRoot = await temp("tk-p5-result-runtime-"); const sessionRoot = await temp("tk-p5-result-sessions-");
  await makeChatGptVault(vault); const acquisition = await makeCompletedAcquisition(acquisitionRuntime);
  const stored = await generatePackage({ action: "generate", acquisitionId: acquisition.id, selectedFiles: ["01_BIBLIOTHEQUE/Intelligence-artificielle/Transformers.md"], suggestedFilesRejected: [], allowStructuralUpdate: structural }, { environment: { YOUTUBE_LIBRARY_PATH: vault }, transcriptionConfig: acquisition.config, runtimeRoot, packageId: "123e4567-e89b-42d3-a456-426614174000", now: new Date("2026-07-22T15:00:00Z") });
  return { vault, runtimeRoot, sessionRoot, stored };
}

function sourceFor(stored: Awaited<ReturnType<typeof fixture>>["stored"], title = stored.manifest.source.title, url = stored.manifest.source.url) {
  return { type: "youtube-video" as const, title, url };
}

describe("Prévalidation du Résultat ChatGPT", () => {
  it("accepte un ZIP Phase 3 correspondant puis réutilise Apply et lie importId/backupId", async () => {
    const f = await fixture(); const manifest = validManifest({ packageId: f.stored.manifest.packageId, source: sourceFor(f.stored) }); const zip = await packageZip(manifest);
    const before = await readFile(path.join(f.vault, "INDEX.md"), "utf8");
    const result = await prevalidateChatGptResult(f.stored.manifest.packageId, zip, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot });
    expect(result.preview.canApply).toBe(true); expect(await readFile(path.join(f.vault, "INDEX.md"), "utf8")).toBe(before);
    const applied = await applyImport({ sessionId: result.preview.sessionId, confirmed: true }, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, sessionRoot: f.sessionRoot });
    expect(applied.status).toBe("success"); const stored = await loadStoredPackage(f.stored.manifest.packageId, f.runtimeRoot); expect(stored.status.status).toBe("imported"); expect(stored.status.importId).toBe(applied.importId); expect(stored.status.backupId).toBe(applied.backupId ?? undefined);
  });
  it("avertit pour un titre légèrement différent", async () => {
    const f = await fixture(); const zip = await packageZip(validManifest({ packageId: f.stored.manifest.packageId, source: sourceFor(f.stored, `${f.stored.manifest.source.title} — analyse`) }));
    const result = await prevalidateChatGptResult(f.stored.manifest.packageId, zip, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot }); expect(result.warnings).toHaveLength(1);
  });
  it("bloque packageId ou URL différente", async () => {
    const f = await fixture();
    await expect(prevalidateChatGptResult(f.stored.manifest.packageId, await packageZip(validManifest({ packageId: "123e4567-e89b-42d3-a456-426614174099", source: sourceFor(f.stored) })), { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot })).rejects.toMatchObject({ code: "PACKAGE_ID_MISMATCH" });
    const f2 = await fixture(); await expect(prevalidateChatGptResult(f2.stored.manifest.packageId, await packageZip(validManifest({ packageId: f2.stored.manifest.packageId, source: sourceFor(f2.stored, f2.stored.manifest.source.title, "https://www.youtube.com/watch?v=zzzzzzzzzzz") })), { environment: { YOUTUBE_LIBRARY_PATH: f2.vault }, runtimeRoot: f2.runtimeRoot, sessionRoot: f2.sessionRoot })).rejects.toMatchObject({ code: "SOURCE_URL_MISMATCH" });
  });
  it("bloque replace hors scope, create hors préfixe et hash différent", async () => {
    const f = await fixture(); const replaceContent = "# Remplacé\n\nNouveau contenu.\n";
    const outsideReplace = validManifest({ packageId: f.stored.manifest.packageId, source: sourceFor(f.stored), operations: [{ type: "replace", path: "00_SYSTEME/CHANGELOG.md", contentFile: "changes/replace/00_SYSTEME/CHANGELOG.md", expectedSha256: "a".repeat(64), newSha256: sha256(replaceContent) }] });
    await expect(prevalidateChatGptResult(f.stored.manifest.packageId, await packageZip(outsideReplace), { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot })).rejects.toMatchObject({ code: "UNSUPPORTED_PHASE3" });
    const f2 = await fixture(); const outsideCreate = validManifest({ packageId: f2.stored.manifest.packageId, source: sourceFor(f2.stored), operations: [{ type: "create", path: "INDEX.md", contentFile: "changes/create/INDEX.md", expectedState: "absent", newSha256: sha256("# Nouvelle notion\n\nContenu sûr.\n") }] });
    await expect(prevalidateChatGptResult(f2.stored.manifest.packageId, await packageZip(outsideCreate), { environment: { YOUTUBE_LIBRARY_PATH: f2.vault }, runtimeRoot: f2.runtimeRoot, sessionRoot: f2.sessionRoot })).rejects.toMatchObject({ code: "UNSUPPORTED_PHASE3" });
    const f3 = await fixture(); const wrongHash = validManifest({ packageId: f3.stored.manifest.packageId, source: sourceFor(f3.stored), operations: [{ type: "replace", path: "02_SOURCES/videos.md", contentFile: "changes/replace/02_SOURCES/videos.md", expectedSha256: "b".repeat(64), newSha256: sha256(replaceContent) }] });
    await expect(prevalidateChatGptResult(f3.stored.manifest.packageId, await packageZip(wrongHash), { environment: { YOUTUBE_LIBRARY_PATH: f3.vault }, runtimeRoot: f3.runtimeRoot, sessionRoot: f3.sessionRoot })).rejects.toMatchObject({ code: "STALE_RESULT" });
  });
  it("bloque un paquet périmé et laisse le vault intact pendant la prévalidation", async () => {
    const f = await fixture(); await writeFile(path.join(f.vault, "INDEX.md"), "# Index changé\n", "utf8"); const before = await readFile(path.join(f.vault, "02_SOURCES", "videos.md"), "utf8");
    await expect(prevalidateChatGptResult(f.stored.manifest.packageId, await packageZip(validManifest({ packageId: f.stored.manifest.packageId, source: sourceFor(f.stored) })), { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot })).rejects.toMatchObject({ code: "STALE_RESULT" }); expect(await readFile(path.join(f.vault, "02_SOURCES", "videos.md"), "utf8")).toBe(before);
  });
  it("exige major et confirmation renforcée pour INDEX ou TAXONOMY", async () => {
    const f = await fixture(true); const replaceContent = "# Remplacé\n\nNouveau contenu.\n"; const manifest = validManifest({ packageId: f.stored.manifest.packageId, source: sourceFor(f.stored), structuralChange: { level: "minor", confirmationRequired: false, summary: "Structure" }, operations: [{ type: "replace", path: "INDEX.md", contentFile: "changes/replace/INDEX.md", expectedSha256: f.stored.preview.snapshot["INDEX.md"], newSha256: sha256(replaceContent) }] });
    await expect(prevalidateChatGptResult(f.stored.manifest.packageId, await packageZip(manifest), { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot })).rejects.toMatchObject({ code: "UNSUPPORTED_PHASE3" });
  });
  it("refuse les opérations et fichiers système interdits via le contrat Phase 3", async () => {
    const f = await fixture(); const invalid = { ...validManifest({ packageId: f.stored.manifest.packageId, source: sourceFor(f.stored) }), operations: [{ type: "delete", path: "01_BIBLIOTHEQUE/Test/x.md" }] };
    const zip = await makeZip([{ name: "manifest.json", content: JSON.stringify(invalid) }, { name: "REVIEW.md", content: "# Revue\n" }]); await expect(prevalidateChatGptResult(f.stored.manifest.packageId, zip, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot })).rejects.toThrow();
  });
  it("distingue le ZIP de demande, un ZIP inconnu et une archive corrompue", async () => {
    const f = await fixture();
    const requestZip = await readFile(await packageZipPath(f.stored.manifest.packageId, f.runtimeRoot));
    await expect(prevalidateChatGptResult(f.stored.manifest.packageId, requestZip, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot })).rejects.toMatchObject({ code: "SOURCE_PACKAGE_SELECTED" });
    await expect(prevalidateChatGptResult(f.stored.manifest.packageId, await makeZip([{ name: "notes.txt", content: "aucun manifeste" }]), { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot })).rejects.toMatchObject({ code: "NO_MANIFEST" });
    await expect(prevalidateChatGptResult(f.stored.manifest.packageId, Buffer.from("pas un zip"), { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot })).rejects.toMatchObject({ code: "CORRUPT_ARCHIVE" });
    await expect(readdir(f.sessionRoot)).resolves.toEqual([]);
  });
  it("accepte immédiatement le bon résultat après le mauvais ZIP", async () => {
    const f = await fixture();
    const requestZip = await readFile(await packageZipPath(f.stored.manifest.packageId, f.runtimeRoot));
    await expect(prevalidateChatGptResult(f.stored.manifest.packageId, requestZip, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot })).rejects.toMatchObject({ code: "SOURCE_PACKAGE_SELECTED" });
    const good = await packageZip(validManifest({ packageId: f.stored.manifest.packageId, source: sourceFor(f.stored) }));
    await expect(prevalidateChatGptResult(f.stored.manifest.packageId, good, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, runtimeRoot: f.runtimeRoot, sessionRoot: f.sessionRoot })).resolves.toMatchObject({ preview: { canApply: true } });
  });
});

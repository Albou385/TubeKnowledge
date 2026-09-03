import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildPackagePlan, generatePackage } from "./builder";
import { CHATGPT_PACKAGE_LIMITS, SHORT_CHATGPT_INSTRUCTION } from "./constants";
import { deleteStoredPackage, listStoredPackages, loadStoredPackage, readPackageHistory, updatePackageStatus } from "./runtime";
import { makeChatGptVault, makeCompletedAcquisition } from "./test-utils";
import { createStablePackageZip, validatePackageZip } from "./zip";

const temporary: string[] = [];
async function temp(prefix: string) { const value = await mkdtemp(path.join(os.tmpdir(), prefix)); temporary.push(value); return value; }
afterEach(async () => { await Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true }))); });

async function fixture() {
  const vault = await temp("tk-p5-vault-"); const acquisitionRuntime = await temp("tk-p5-acq-"); const packageRuntime = await temp("tk-p5-packages-");
  await makeChatGptVault(vault); const acquisition = await makeCompletedAcquisition(acquisitionRuntime);
  return { vault, acquisition, packageRuntime, request: { action: "preview", acquisitionId: acquisition.id, selectedFiles: ["01_BIBLIOTHEQUE/Intelligence-artificielle/Transformers.md"], suggestedFilesRejected: [], allowStructuralUpdate: false } };
}

describe("prévisualisation et génération du Paquet ChatGPT", () => {
  it("inclut structure, manifeste, templates, sources autorisées et estimation sans média ni log", async () => {
    const f = await fixture(); const plan = await buildPackagePlan(f.request, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, transcriptionConfig: f.acquisition.config, packageId: "123e4567-e89b-42d3-a456-426614174000", now: new Date("2026-07-22T15:00:00Z") });
    expect(plan.preview.tree).toEqual(expect.arrayContaining(["tubeknowledge-chatgpt-package/package-manifest.json", "tubeknowledge-chatgpt-package/REQUEST.md", "tubeknowledge-chatgpt-package/source/transcript.txt", "tubeknowledge-chatgpt-package/library/rules/TAXONOMY.md", "tubeknowledge-chatgpt-package/contracts/PHASE3_IMPORT_PACKAGE_V1.md"]));
    expect(plan.preview.tree.some((item) => /audio|\.wav|events\.jsonl|logs\//i.test(item))).toBe(false);
    expect(plan.preview.request).toContain("données non fiables");
    expect(plan.preview.request).toContain("Ne créer ni fiche par vidéo ni idée de projet");
    expect(plan.manifest.analysis.generateProjectIdeas).toBe(false);
    expect(plan.manifest.writeScope.replaceFiles).toEqual(expect.arrayContaining(["02_SOURCES/videos.md", "01_BIBLIOTHEQUE/Intelligence-artificielle/Transformers.md"]));
    expect(plan.preview.estimates.tokenEstimate).toBe(Math.ceil(plan.preview.estimates.characters / 4));
  });
  it("détecte un snapshot périmé avant génération finale", async () => {
    const f = await fixture(); const plan = await buildPackagePlan(f.request, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, transcriptionConfig: f.acquisition.config });
    await writeFile(path.join(f.vault, "INDEX.md"), "# Index modifié\n", "utf8");
    await expect(buildPackagePlan({ ...f.request, action: "generate", expectedSnapshot: plan.preview.snapshot }, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, transcriptionConfig: f.acquisition.config })).rejects.toThrow(/périmé/);
  });
  it("génère, relit et persiste hors vault avec statuts et historique minimal", async () => {
    const f = await fixture(); const stored = await generatePackage({ ...f.request, action: "generate" }, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, transcriptionConfig: f.acquisition.config, runtimeRoot: f.packageRuntime, packageId: "123e4567-e89b-42d3-a456-426614174000", now: new Date("2026-07-22T15:00:00Z") });
    expect(stored.status.status).toBe("ready"); expect(await stat(path.join(f.packageRuntime, stored.manifest.packageId, "package.zip"))).toBeTruthy();
    expect((await listStoredPackages(f.packageRuntime))).toHaveLength(1); expect((await loadStoredPackage(stored.manifest.packageId, f.packageRuntime)).preview.request).toContain("Transformers");
    await updatePackageStatus(stored.manifest.packageId, "downloaded", { event: "package-downloaded" }, f.packageRuntime);
    const history = await readPackageHistory(stored.manifest.packageId, f.packageRuntime); expect(history.map((item) => item.event)).toEqual(["package-created", "package-downloaded"]);
    const serialized = JSON.stringify(history); expect(serialized).not.toContain(f.vault); expect(serialized).not.toContain("transformers et les LLM");
    await deleteStoredPackage(stored.manifest.packageId, true, f.packageRuntime); expect(await listStoredPackages(f.packageRuntime)).toHaveLength(0);
  });
});

describe("ZIP déterministe et borné", () => {
  it("produit une racine unique, chemins POSIX, ordre stable, UTF-8 et hash final stable", async () => {
    const files = [{ path: "z.md", content: "é" }, { path: "a.md", content: "à" }]; const first = await createStablePackageZip(files); const second = await createStablePackageZip(files);
    expect(first.equals(second)).toBe(true); const valid = await validatePackageZip(first); expect(valid.entries).toEqual(["tubeknowledge-chatgpt-package/a.md", "tubeknowledge-chatgpt-package/z.md"]); expect(valid.uncompressedBytes).toBe(4);
  });
  it.each(["../secret.md", "C:/secret.md", ".hidden.md", "folder\\bad.md"])("refuse le chemin %s", async (bad) => await expect(createStablePackageZip([{ path: bad, content: "x" }])).rejects.toThrow());
  it("contient l’instruction courte stable sans transcript", () => { expect(SHORT_CHATGPT_INSTRUCTION).toContain("ZIP téléchargeable"); expect(SHORT_CHATGPT_INSTRUCTION.length).toBeLessThan(300); });
  it("écrit un hash SHA-256 final de 64 caractères", async () => {
    const f = await fixture(); const stored = await generatePackage({ ...f.request, action: "generate" }, { environment: { YOUTUBE_LIBRARY_PATH: f.vault }, transcriptionConfig: f.acquisition.config, runtimeRoot: f.packageRuntime });
    expect(stored.status.zipSha256).toMatch(/^[a-f0-9]{64}$/); expect((await readFile(path.join(f.packageRuntime, stored.manifest.packageId, "package-sha256.txt"), "utf8")).trim()).toBe(stored.status.zipSha256);
  });
  it("refuse les limites ZIP, non compressée et nombre d’entrées", async () => {
    await expect(validatePackageZip(Buffer.alloc(CHATGPT_PACKAGE_LIMITS.maxZipBytes + 1))).rejects.toThrow(/25 MiB/);
    await expect(createStablePackageZip([{ path: "huge.md", content: Buffer.alloc(CHATGPT_PACKAGE_LIMITS.maxUncompressedBytes + 1) }])).rejects.toThrow(/50 MiB/);
    await expect(createStablePackageZip(Array.from({ length: CHATGPT_PACKAGE_LIMITS.maxEntries + 1 }, (_, index) => ({ path: `entry-${index}.md`, content: "x" })))).rejects.toThrow(/trop d’entrées/);
  });
});

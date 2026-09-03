import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { generatePackage } from "../src/lib/chatgpt-packages/builder";
import { suggestContextFiles } from "../src/lib/chatgpt-packages/context";
import { loadStoredPackage } from "../src/lib/chatgpt-packages/runtime";
import { prevalidateChatGptResult } from "../src/lib/chatgpt-packages/result";
import { makeChatGptVault, makeCompletedAcquisition } from "../src/lib/chatgpt-packages/test-utils";
import { validatePackageZip } from "../src/lib/chatgpt-packages/zip";
import { applyImport } from "../src/lib/imports/apply";
import { packageZip, validManifest } from "../src/lib/imports/test-utils";

async function fingerprint(root: string | undefined): Promise<string | null> {
  if (!root) return null;
  const hash = createHash("sha256");
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const target = path.join(directory, entry.name); const details = await lstat(target); if (details.isSymbolicLink()) continue;
      const relative = path.relative(root!, target).split(path.sep).join("/"); hash.update(relative);
      if (details.isDirectory()) await visit(target); else if (details.isFile()) hash.update(await readFile(target));
    }
  }
  await visit(root); return hash.digest("hex");
}

async function main() {
  loadEnvConfig(process.cwd());
  const trueVaultBefore = await fingerprint(process.env.YOUTUBE_LIBRARY_PATH);
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-phase5-smoke-"));
  const vault = path.join(root, "vault"); const acquisitionRuntime = path.join(root, "acquisition-runtime"); const packageRuntime = path.join(root, "package-runtime"); const sessions = path.join(root, "sessions");
  try {
    await makeChatGptVault(vault);
    const acquisition = await makeCompletedAcquisition(acquisitionRuntime, "Transformers LLM attention TypeScript Zod.\n");
    const suggestions = await suggestContextFiles(acquisition.id, 5, { environment: { YOUTUBE_LIBRARY_PATH: vault }, transcriptionConfig: acquisition.config });
    if (!suggestions.length) throw new Error("Aucune suggestion lexicale factice.");
    const stored = await generatePackage({ action: "generate", acquisitionId: acquisition.id, selectedFiles: [suggestions[0].relativePath], suggestedFilesRejected: [], allowStructuralUpdate: false }, { environment: { YOUTUBE_LIBRARY_PATH: vault }, transcriptionConfig: acquisition.config, runtimeRoot: packageRuntime });
    const zip = await readFile(path.join(packageRuntime, stored.manifest.packageId, "package.zip")); await validatePackageZip(zip);
    const resultZip = await packageZip(validManifest({ packageId: stored.manifest.packageId, source: { type: "youtube-video", title: stored.manifest.source.title, url: stored.manifest.source.url } }));
    const result = await prevalidateChatGptResult(stored.manifest.packageId, resultZip, { environment: { YOUTUBE_LIBRARY_PATH: vault }, runtimeRoot: packageRuntime, sessionRoot: sessions });
    const applied = await applyImport({ sessionId: result.preview.sessionId, confirmed: true }, { environment: { YOUTUBE_LIBRARY_PATH: vault }, sessionRoot: sessions });
    if (applied.status !== "success") throw new Error(`Apply factice échoué : ${applied.status}`);
    if ((await loadStoredPackage(stored.manifest.packageId, packageRuntime)).status.status !== "imported") throw new Error("Statut local non importé.");
    await readFile(path.join(vault, "01_BIBLIOTHEQUE", "Test", "notion.md"), "utf8");
    const trueVaultAfter = await fingerprint(process.env.YOUTUBE_LIBRARY_PATH);
    if (trueVaultBefore !== trueVaultAfter) throw new Error("Le vrai vault a changé pendant la fumée factice.");
    console.log("[OK] acquisition completed factice, suggestions et sélection");
    console.log("[OK] paquet, validation ZIP et résultat Phase 3 factice");
    console.log("[OK] Prévalidation Phase 5, Preview/Apply Phase 3 et statut local imported");
    console.log("[OK] écriture uniquement dans le vault temporaire via Phase 3; vrai vault intact");
  } finally { await rm(root, { recursive: true, force: true }); }
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Fumée Phase 5 échouée."); process.exitCode = 1; });

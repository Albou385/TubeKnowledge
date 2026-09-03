import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { generatePackage } from "../src/lib/chatgpt-packages/builder";
import { parseLibraryConfig } from "../src/lib/config/library-config";
import { getTranscriptionConfig } from "../src/lib/transcription/config";
import { listJobs } from "../src/lib/transcription/runtime";

async function fingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      const target = path.join(directory, entry.name); const details = await lstat(target); if (details.isSymbolicLink()) continue;
      hash.update(path.relative(root, target).split(path.sep).join("/"));
      if (details.isDirectory()) await visit(target); else if (details.isFile()) hash.update(await readFile(target));
    }
  }
  await visit(root); return hash.digest("hex");
}

async function main() {
  loadEnvConfig(process.cwd());
  const library = parseLibraryConfig(process.env); if (!library.ok) throw new Error(library.message);
  const config = getTranscriptionConfig(); const requestedId = process.argv[2];
  const jobs = await listJobs(config); const job = requestedId ? jobs.find((item) => item.id === requestedId) : jobs.find((item) => item.status === "completed" && item.artifacts.some((artifact) => artifact.name === "transcript.txt"));
  if (!job || job.status !== "completed") throw new Error("Aucune acquisition terminée appropriée. Fournissez son UUID : scripts/phase5-manual-check.ps1 -AcquisitionId <UUID>.");
  const before = await fingerprint(library.rootPath);
  const stored = await generatePackage({ action: "generate", acquisitionId: job.id, selectedFiles: [], suggestedFilesRejected: [], allowStructuralUpdate: false });
  const after = await fingerprint(library.rootPath); if (before !== after) throw new Error("Le vault a changé pendant la génération manuelle.");
  console.log(`[OK] Paquet ${stored.manifest.packageId}`);
  console.log(`[OK] SHA-256 ${stored.status.zipSha256}; ${stored.status.zipBytes} octets`);
  console.log("[OK] Acquisition existante lue sans modification; vault identique avant/après");
  console.log(`Ouvrez /chatgpt-packages/${stored.manifest.packageId}, inspectez l’arborescence et téléchargez le ZIP.`);
  console.log("Téléversez-le manuellement dans le projet ChatGPT, puis revenez à la page Résultat. Aucun appel IA n’a été effectué.");
}

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Manual-check Phase 5 échoué."); process.exitCode = 1; });

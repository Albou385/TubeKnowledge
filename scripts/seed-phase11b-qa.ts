import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { emptyVideoQueueStore, saveVideoQueueStore } from "../src/lib/video-queue/runtime";

async function main() {
  const qaRoot = path.resolve(process.env.TUBEKNOWLEDGE_QA_ROOT || path.join(os.tmpdir(), "tubeknowledge-phase11b-playwright"));
  const relative = path.relative(path.resolve(os.tmpdir()), qaRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("La fixture Phase 11B doit rester sous %TEMP%.");
  await rm(qaRoot, { recursive: true, force: true });
  const vault = path.join(qaRoot, "vault");
  const queueRoot = path.join(qaRoot, "runtime", "video-queue");
  await mkdir(path.join(vault, "02_SOURCES"), { recursive: true });
  const index = "# Vault Phase 11B factice\n";
  const videos = "# Vidéos\n\n| Titre | URL | Sections | Statut |\n|---|---|---|---|\n";
  await writeFile(path.join(vault, "INDEX.md"), index, "utf8");
  await writeFile(path.join(vault, "02_SOURCES", "videos.md"), videos, "utf8");
  await saveVideoQueueStore(emptyVideoQueueStore(), queueRoot);
  await writeFile(path.join(qaRoot, "fixture.json"), `${JSON.stringify({ schemaVersion: 1, vaultHash: createHash("sha256").update(index + videos).digest("hex") }, null, 2)}\n`, "utf8");
  process.stdout.write("[OK] fixture Phase 11B créée sous %TEMP%, sans workflow, worker ou session Apply\n");
}

main().catch((error) => { process.stderr.write(error instanceof Error ? error.message : "Fixture Phase 11B invalide."); process.exitCode = 1; });


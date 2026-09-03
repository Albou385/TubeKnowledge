import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { generatePackage } from "../src/lib/chatgpt-packages/builder";
import { makeChatGptVault, makeCompletedAcquisition } from "../src/lib/chatgpt-packages/test-utils";
import { sha256 } from "../src/lib/imports/hash";
import { packageZip, validManifest } from "../src/lib/imports/test-utils";
import { createPortabilityBackup } from "../src/lib/portability/backup-builder";
import { createCheckpoint } from "../src/lib/portability/checkpoints";
import { getPortabilityConfig } from "../src/lib/portability/config";
import { ensureMachineIdentity } from "../src/lib/portability/machine-identity";
import { createVaultSnapshot } from "../src/lib/portability/snapshots";
import { acquireWriterAuthority } from "../src/lib/portability/writer-authority";
import { saveWorkflow } from "../src/lib/workflows/runtime";
import { nextActionForState } from "../src/lib/workflows/schema";

const root = path.resolve(process.env.TUBEKNOWLEDGE_QA_ROOT || path.join(os.tmpdir(), "tubeknowledge-phase10-4-playwright"));
const tempRoot = path.resolve(os.tmpdir());
if (!root.toLocaleLowerCase("en").startsWith(`${tempRoot.toLocaleLowerCase("en")}${path.sep}`)) throw new Error("Le seed Phase 10.4 doit rester sous le dossier temporaire du système.");

const oneDrive = path.join(root, "OneDrive");
const vault = path.join(oneDrive, "vault");
const runtime = path.join(root, "runtime");
const packageRoot = path.join(runtime, "chatgpt-packages");
const workflowRoot = path.join(runtime, "video-knowledge-workflows");
const state = path.join(root, "state");
const backups = path.join(root, "backups");
const sessions = path.join(root, "import-sessions");
const ids = {
  packageOne: "573310e0-7871-4e10-a433-d560e028a341",
  packageTwo: "573310e0-7871-4e10-a433-d560e028a342",
  workflowOne: "18fb940b-fc0e-4ccd-87e4-59eacec6c171",
  workflowTwo: "18fb940b-fc0e-4ccd-87e4-59eacec6c173",
};

async function main() {
  await rm(root, { recursive: true, force: true });
  await Promise.all([makeChatGptVault(vault), mkdir(workflowRoot, { recursive: true }), mkdir(state, { recursive: true }), mkdir(backups, { recursive: true }), mkdir(sessions, { recursive: true })]);
  const acquisition = await makeCompletedAcquisition(runtime, "Obsidian permet un système de notes local-first relié par des liens internes et organisé progressivement.\n");
  const now = new Date();
  const environment = { ...process.env, YOUTUBE_LIBRARY_PATH: vault };

  for (const [index, packageId] of [ids.packageOne, ids.packageTwo].entries()) {
    const stored = await generatePackage({ action: "generate", acquisitionId: acquisition.id, selectedFiles: [], suggestedFilesRejected: [], allowStructuralUpdate: false }, { environment, processEnvironment: process.env, transcriptionConfig: acquisition.config, runtimeRoot: packageRoot, packageId, now });
    const relativePath = index === 0 ? "01_BIBLIOTHEQUE/Test/notion.md" : "01_BIBLIOTHEQUE/Test/notion-deux.md";
    const result = await packageZip(validManifest({
      packageId,
      source: { type: "youtube-video", title: stored.manifest.source.title, url: stored.manifest.source.url },
      structuralChange: { level: "major", confirmationRequired: true, summary: "Création contrôlée d’une section de test." },
      operations: [{ type: "create", path: relativePath, contentFile: `changes/create/${relativePath}`, expectedState: "absent", newSha256: sha256("# Nouvelle notion\n\nContenu sûr.\n") }],
    }));
    await writeFile(path.join(root, `result-${index + 1}.zip`), result);
    const workflowId = index === 0 ? ids.workflowOne : ids.workflowTwo;
    await saveWorkflow({ schemaVersion: 1, workflowId, createdAt: now.toISOString(), updatedAt: now.toISOString(), state: "awaiting-result", sourceUrl: stored.manifest.source.url, videoId: stored.manifest.source.videoId, title: stored.manifest.source.title, acquisitionId: acquisition.id, packageId, nextAction: nextActionForState("awaiting-result"), reprocessingApproved: false, knowledgePaths: [] }, workflowRoot);
  }

  const config = getPortabilityConfig(process.env);
  const identity = await ensureMachineIdentity(config, { machineId: "11111111-1111-4111-8111-111111111111", displayName: "Phase 10.4 QA", rolePreference: "writer", now });
  const backup = await createPortabilityBackup(vault, config, identity, "knowledge", { now, backupId: "70000000-0000-4000-8000-000000000004", wait: async () => undefined, gitCommit: "f41d32a" });
  const snapshot = await createVaultSnapshot(vault, identity.machineId, { now });
  const checkpoint = await createCheckpoint(vault, snapshot, "backup", { now, checkpointId: "80000000-0000-4000-8000-000000000004", backupId: backup.backupId });
  const expiredAt = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  await acquireWriterAuthority(vault, identity, checkpoint, 30, { now: expiredAt, force: true, verifiedBackupId: backup.backupId, confirmationText: "REPRENDRE", authorityId: "90000000-0000-4000-8000-000000000004" });

  await writeFile(path.join(root, "fixture.json"), `${JSON.stringify({ root, vault, runtime, packageRoot, workflowRoot, state, backups, sessions, ids, resultOne: path.join(root, "result-1.zip"), resultTwo: path.join(root, "result-2.zip") }, null, 2)}\n`, "utf8");
  console.log(`Seed Phase 10.4 prêt: ${root}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Échec du seed Phase 10.4.");
  process.exitCode = 1;
});

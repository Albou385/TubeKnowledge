import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createPortabilityBackup } from "../src/lib/portability/backup-builder";
import { createCheckpoint } from "../src/lib/portability/checkpoints";
import { getPortabilityConfig } from "../src/lib/portability/config";
import { ensureMachineIdentity } from "../src/lib/portability/machine-identity";
import { createVaultSnapshot, persistLatestSnapshot } from "../src/lib/portability/snapshots";
import { acquireWriterAuthority } from "../src/lib/portability/writer-authority";

(async () => {
const root = path.resolve(process.env.TUBEKNOWLEDGE_QA_ROOT || path.join(os.tmpdir(), "tubeknowledge-expired-local-conflict-qa"));
if (!root.toLocaleLowerCase("en").startsWith(path.resolve(os.tmpdir()).toLocaleLowerCase("en") + path.sep)) throw new Error("La fixture QA doit rester dans le dossier temporaire du système.");
const oneDrive = path.join(root, "OneDrive");
const vault = path.join(oneDrive, "vault");
const statePath = path.join(root, "state");
const backupPath = path.join(root, "backups");
const now = new Date();
const grantedAt = new Date(now.getTime() - 2 * 60_000);

await rm(root, { recursive: true, force: true });
await mkdir(path.join(vault, "02_SOURCES"), { recursive: true });
await writeFile(path.join(vault, "INDEX.md"), "# Index fixture\n");
await writeFile(path.join(vault, "02_SOURCES", "videos.md"), "# Vidéos initiales\n");
const env = {
  YOUTUBE_LIBRARY_PATH: vault, TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: statePath, TUBEKNOWLEDGE_BACKUP_PATH: backupPath,
  TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0", TUBEKNOWLEDGE_WRITER_LEASE_MINUTES: "30", TUBEKNOWLEDGE_MACHINE_NAME: "Portable QA", TUBEKNOWLEDGE_MACHINE_ROLE: "writer",
};
const config = getPortabilityConfig(env);
const identity = await ensureMachineIdentity(config, { machineId: "61111111-1111-4111-8111-111111111111", now: grantedAt });
const baseline = await createVaultSnapshot(vault, identity.machineId, { now: grantedAt });
await persistLatestSnapshot(config, baseline);
const checkpoint = await createCheckpoint(vault, baseline, "backup", { now: grantedAt });
await acquireWriterAuthority(vault, identity, checkpoint, 1, { now: grantedAt, force: true, verifiedBackupId: "72222222-2222-4222-8222-222222222222", confirmationText: "REPRENDRE" });
await writeFile(path.join(vault, "02_SOURCES", "videos.md"), "# Vidéos confirmées par la fixture\n");
const backup = await createPortabilityBackup(vault, config, identity, "knowledge", { now, wait: async () => undefined, gitCommit: "abcdef0" });
const conflictId = "73333333-3333-4333-8333-333333333333";
await writeFile(path.join(statePath, "conflicts.json"), `${JSON.stringify([{
  schemaVersion: 1, conflictId, type: "content-divergence", detectedAt: now.toISOString(), paths: ["02_SOURCES/videos.md"], baseCheckpointId: checkpoint.checkpointId,
  severity: "blocking", status: "open", evidence: { reason: "Modification légitime de fixture" },
}], null, 2)}\n`);
await writeFile(path.join(root, "fixture.json"), `${JSON.stringify({ vault, statePath, conflictId, backupId: backup.backupId }, null, 2)}\n`);
})().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

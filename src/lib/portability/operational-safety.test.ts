import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPortabilityBackup } from "./backup-builder";
import { createCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { detectConflicts } from "./conflicts";
import { appendPortabilityHistory } from "./history";
import { inspectLocalMaintenance } from "./maintenance";
import { ensureMachineIdentity } from "./machine-identity";
import { compareSnapshots, createVaultSnapshot } from "./snapshots";
import { acquireWriterAuthority } from "./writer-authority";

const roots: string[] = [];

async function fixture(retention = "10") {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-p61-safety-"));
  roots.push(root);
  const oneDrive = path.join(root, "OneDrive");
  const vault = path.join(oneDrive, "vault");
  await mkdir(path.join(vault, "01_BIBLIOTHEQUE"), { recursive: true });
  await writeFile(path.join(vault, "INDEX.md"), "# Index\n");
  await writeFile(path.join(vault, "01_BIBLIOTHEQUE", "note.md"), "# Note\n");
  const env = { YOUTUBE_LIBRARY_PATH: vault, TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups"), TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0", TUBEKNOWLEDGE_BACKUP_RETENTION_COUNT: retention };
  const config = getPortabilityConfig(env);
  const identity = await ensureMachineIdentity(config, { machineId: "11111111-1111-4111-8111-111111111111", now: new Date("2026-07-23T12:00:00Z") });
  return { root, oneDrive, vault, env, config, identity };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("prévention des faux conflits", () => {
  it("ignore writer, backup, checkpoint, historique, locks, caches et staging techniques", async () => {
    const f = await fixture();
    const base = await createVaultSnapshot(f.vault, f.identity.machineId);
    const backup = await createPortabilityBackup(f.vault, f.config, f.identity, "knowledge", { now: new Date("2026-07-23T12:00:00Z"), wait: async () => undefined, gitCommit: "abcdef0" });
    const checkpoint = await createCheckpoint(f.vault, base, "backup", { now: new Date("2026-07-23T12:00:00Z"), backupId: backup.backupId });
    await acquireWriterAuthority(f.vault, f.identity, checkpoint, 30, { now: new Date("2026-07-23T12:00:00Z"), force: true, verifiedBackupId: backup.backupId, confirmationText: "REPRENDRE" });
    await appendPortabilityHistory(f.config.statePath, { schemaVersion: 1, eventId: "22222222-2222-4222-8222-222222222222", event: "writer-acquired", timestamp: "2026-07-23T12:00:00Z" });
    for (const directory of ["runtime", "locks", "history", "backups", "state", "temp", "tmp", ".tmp", "cache", ".cache", "staging"]) {
      await mkdir(path.join(f.vault, directory), { recursive: true });
      await writeFile(path.join(f.vault, directory, "technical.md"), "technique");
    }
    const current = await createVaultSnapshot(f.vault, f.identity.machineId);
    expect(compareSnapshots(base, current)).toMatchObject({ stable: true, changedPaths: [] });
    expect(await detectConflicts(current, f.config, checkpoint, { baseSnapshot: base, writerAuthority: await import("./writer-authority").then((module) => module.readWriterAuthority(f.vault)) })).toEqual([]);
  });

  it("détecte toujours une modification et une suppression Markdown réelles", async () => {
    const f = await fixture();
    const base = await createVaultSnapshot(f.vault, f.identity.machineId);
    await writeFile(path.join(f.vault, "INDEX.md"), "# Modifié\n");
    await rm(path.join(f.vault, "01_BIBLIOTHEQUE", "note.md"));
    const current = await createVaultSnapshot(f.vault, f.identity.machineId);
    const conflicts = await detectConflicts(current, f.config, null, { baseSnapshot: base });
    expect(conflicts.map((item) => item.type)).toEqual(expect.arrayContaining(["content-divergence", "deleted-vs-modified"]));
  });
});

describe("maintenance locale", () => {
  it("reste en dry-run, liste les expirations et protège les backups requis", async () => {
    const f = await fixture("1");
    await createPortabilityBackup(f.vault, f.config, f.identity, "knowledge", { now: new Date("2026-07-20T12:00:00Z"), wait: async () => undefined, gitCommit: "abcdef0" });
    await createPortabilityBackup(f.vault, f.config, f.identity, "knowledge", { now: new Date("2026-07-21T12:00:00Z"), wait: async () => undefined, gitCommit: "abcdef0" });
    await createPortabilityBackup(f.vault, f.config, f.identity, "knowledge", { now: new Date("2026-07-22T12:00:00Z"), wait: async () => undefined, gitCommit: "abcdef0" });
    const recordsDir = path.join(f.config.statePath, "writer-operations-idempotency");
    await mkdir(recordsDir, { recursive: true });
    const expiredPath = path.join(recordsDir, "33333333-3333-4333-8333-333333333333.json");
    await writeFile(expiredPath, JSON.stringify({ idempotencyKey: "33333333-3333-4333-8333-333333333333", expiresAt: "2026-07-22T00:00:00Z" }));
    const tempPath = path.join(f.config.statePath, "orphan.tmp");
    await writeFile(tempPath, "temp");
    await utimes(tempPath, new Date("2026-07-20T00:00:00Z"), new Date("2026-07-20T00:00:00Z"));
    const result = await inspectLocalMaintenance(f.config, new Date("2026-07-23T12:00:00Z"));
    expect(result.dryRun).toBe(true);
    expect(result.candidates.map((item) => item.kind)).toEqual(expect.arrayContaining(["expired-idempotency", "temporary-file", "backup-retention"]));
    expect(await readFile(expiredPath, "utf8")).toContain("expiresAt");
    expect(await readFile(tempPath, "utf8")).toBe("temp");
    const retention = result.candidates.filter((item) => item.kind === "backup-retention");
    expect(retention).toHaveLength(2);
    expect(retention.every((item) => !item.protected)).toBe(true);
  });
});

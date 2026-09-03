import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPortabilityBackup } from "./backup-builder";
import { createCheckpoint, latestCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { detectConflicts, loadConflicts } from "./conflicts";
import { listHandoffs } from "./handoff";
import { readPortabilityHistory } from "./history";
import { ensureMachineIdentity } from "./machine-identity";
import { createVaultSnapshot, persistLatestSnapshot, readLatestSnapshot } from "./snapshots";
import { reconcileStaleBaselineAndReacquireWriter } from "./stale-baseline-expired-writer-reconcile";
import { getPortabilityStatus } from "./status";
import { acquireWriterAuthority, readWriterAuthority, writerAuthorityPath } from "./writer-authority";

vi.mock("./one-drive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./one-drive")>();
  const hydratedProbe = async () => ({ offline: false, unpinned: false });
  return { ...actual, probeWindowsAttributes: hydratedProbe, inspectOneDriveLocal: (...args: Parameters<typeof actual.inspectOneDriveLocal>) => actual.inspectOneDriveLocal(args[0], args[1], args[2], args[3] ?? hydratedProbe) };
});

const roots: string[] = [];
const start = new Date("2026-09-03T10:00:00.000Z");
const expiredAt = new Date("2026-09-03T10:02:00.000Z");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-stale-baseline-")); roots.push(root);
  const oneDrive = path.join(root, "OneDrive"); const vault = path.join(oneDrive, "vault");
  await mkdir(path.join(vault, "02_SOURCES"), { recursive: true });
  await writeFile(path.join(vault, "INDEX.md"), "# Index\n"); await writeFile(path.join(vault, "02_SOURCES", "videos.md"), "# Ancien contenu\n");
  const env = { YOUTUBE_LIBRARY_PATH: vault, TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups"), TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0", TUBEKNOWLEDGE_WRITER_LEASE_MINUTES: "30", TUBEKNOWLEDGE_MACHINE_NAME: "Portable fixture", TUBEKNOWLEDGE_MACHINE_ROLE: "reader" };
  const config = getPortabilityConfig(env); const identity = await ensureMachineIdentity(config, { machineId: "11111111-1111-4111-8111-111111111111", now: start });
  const baseline = await createVaultSnapshot(vault, identity.machineId, { now: start }); await persistLatestSnapshot(config, baseline);
  const staleBackup = await createPortabilityBackup(vault, config, identity, "knowledge", { now: start, wait: async () => undefined, gitCommit: "abcdef0" });
  await writeFile(path.join(vault, "02_SOURCES", "videos.md"), "# Contenu checkpointé\n");
  await mkdir(path.join(vault, "03_A_TRAITER"), { recursive: true });
  await writeFile(path.join(vault, "03_A_TRAITER", "note.md"), "# Seize différences représentées par la fixture\n");
  const current = await createVaultSnapshot(vault, identity.machineId, { now: expiredAt }); const checkpoint = await createCheckpoint(vault, current, "backup", { now: expiredAt });
  await acquireWriterAuthority(vault, identity, checkpoint, 1, { now: start, force: true, verifiedBackupId: randomUUID(), confirmationText: "REPRENDRE" });
  const backup = await createPortabilityBackup(vault, config, identity, "knowledge", { now: expiredAt, wait: async () => undefined, gitCommit: "abcdef0" });
  const conflictId = "33333333-3333-4333-8333-333333333333";
  await writeFile(path.join(config.statePath, "conflicts.json"), `${JSON.stringify([{ schemaVersion: 1, conflictId, type: "content-divergence", detectedAt: expiredAt.toISOString(), paths: ["02_SOURCES/videos.md"], baseCheckpointId: checkpoint.checkpointId, severity: "blocking", status: "open", evidence: { reason: "Baseline locale périmée" } }], null, 2)}\n`);
  return { root, vault, env, config, identity, baseline, current, checkpoint, backup, staleBackup, conflictId };
}

function input(f: Awaited<ReturnType<typeof fixture>>, idempotencyKey = randomUUID()) { return { conflictId: f.conflictId, backupId: f.backup.backupId, confirmationText: "RECONCILIER ET REACQUERIR", idempotencyKey }; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("réconcilier une baseline locale périmée", () => {
  it("réconcilie le checkpoint existant sans modifier le Markdown", async () => {
    const f = await fixture(); const target = path.join(f.vault, "02_SOURCES", "videos.md"); const before = await readFile(target); const checkpointBefore = await latestCheckpoint(f.vault);
    const result = await reconcileStaleBaselineAndReacquireWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined });
    expect(await readFile(target)).toEqual(before); expect((await readLatestSnapshot(f.config))?.rootHash).toBe(f.current.rootHash);
    expect(await latestCheckpoint(f.vault)).toEqual(checkpointBefore); expect(result.checkpoint.checkpointId).toBe(f.checkpoint.checkpointId);
    expect(await readWriterAuthority(f.vault)).toMatchObject({ machineId: f.identity.machineId, checkpointId: f.checkpoint.checkpointId, status: "active" });
    expect(await loadConflicts(f.config)).toEqual([expect.objectContaining({ conflictId: f.conflictId, status: "resolved" })]);
    const next = await createVaultSnapshot(f.vault, f.identity.machineId, { now: expiredAt });
    expect((await detectConflicts(next, f.config, await latestCheckpoint(f.vault), { baseSnapshot: await readLatestSnapshot(f.config) || undefined, writerAuthority: await readWriterAuthority(f.vault) })).filter((item) => item.type === "content-divergence")).toEqual([]);
  });

  it.each(["baseline", "authority", "conflicts"] as const)("reprend ou rollback fail-closed après interruption %s", async (crashAfter) => {
    const f = await fixture(); const key = randomUUID(); const target = path.join(f.vault, "02_SOURCES", "videos.md"); const before = await readFile(target);
    await expect(reconcileStaleBaselineAndReacquireWriter(input(f, key), f.env, { now: expiredAt, wait: async () => undefined, crashAfter })).rejects.toBeInstanceOf(Error);
    await expect(getPortabilityStatus(f.env, expiredAt)).resolves.toMatchObject({ writer: { canWrite: false } });
    await reconcileStaleBaselineAndReacquireWriter(input(f, key), f.env, { now: expiredAt, wait: async () => undefined });
    expect(await readFile(target)).toEqual(before); expect((await loadConflicts(f.config))[0]?.status).toBe("resolved");
  });

  it("est idempotent et ne journalise qu’une fois", async () => {
    const f = await fixture(); const key = randomUUID(); const first = await reconcileStaleBaselineAndReacquireWriter(input(f, key), f.env, { now: expiredAt, wait: async () => undefined }); const replay = await reconcileStaleBaselineAndReacquireWriter(input(f, key), f.env, { now: expiredAt, wait: async () => undefined });
    expect(replay).toEqual(first); expect((await readPortabilityHistory(f.config.statePath)).filter((entry) => entry.event === "stale-baseline-reconciled")).toHaveLength(1);
  });

  it("refuse backup, checkpoint, writer, handoff et contenu courant non prouvés", async () => {
    const backupMismatch = await fixture(); await writeFile(path.join(backupMismatch.vault, "INDEX.md"), "# Après backup\n"); await expect(reconcileStaleBaselineAndReacquireWriter(input(backupMismatch), backupMismatch.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "STALE_BASELINE_RECONCILE_NOT_ALLOWED" });
    const authorityMismatch = await fixture(); const authority = JSON.parse(await readFile(writerAuthorityPath(authorityMismatch.vault), "utf8")); authority.checkpointId = "44444444-4444-4444-8444-444444444444"; await writeFile(writerAuthorityPath(authorityMismatch.vault), JSON.stringify(authority)); await expect(reconcileStaleBaselineAndReacquireWriter(input(authorityMismatch), authorityMismatch.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "STALE_BASELINE_RECONCILE_NOT_ALLOWED" });
    const remoteWriter = await fixture(); const remote = JSON.parse(await readFile(writerAuthorityPath(remoteWriter.vault), "utf8")); remote.machineId = "22222222-2222-4222-8222-222222222222"; await writeFile(writerAuthorityPath(remoteWriter.vault), JSON.stringify(remote)); await expect(reconcileStaleBaselineAndReacquireWriter(input(remoteWriter), remoteWriter.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "STALE_BASELINE_RECONCILE_NOT_ALLOWED" });
    const handoff = await fixture(); const handoffId = "55555555-5555-4555-8555-555555555555"; const handoffPath = path.join(handoff.vault, ".tubeknowledge", "portability", "handoffs", `${handoffId}.json`); await mkdir(path.dirname(handoffPath), { recursive: true }); await writeFile(handoffPath, JSON.stringify({ schemaVersion: 1, handoffId, sourceMachineId: handoff.identity.machineId, sourceDisplayName: "Portable", checkpointId: handoff.checkpoint.checkpointId, rootHash: handoff.checkpoint.rootHash, backupId: handoff.backup.backupId, createdAt: start.toISOString(), expiresAt: new Date("2026-09-03T12:00:00.000Z").toISOString(), status: "prepared" })); await expect(reconcileStaleBaselineAndReacquireWriter(input(handoff), handoff.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_REACQUIRE_BLOCKED_BY_HANDOFF" }); expect(await listHandoffs(handoff.vault)).toHaveLength(1);
  });

  it("refuse le backup dont la racine ne correspond pas au checkpoint courant", async () => {
    const f = await fixture();
    await expect(reconcileStaleBaselineAndReacquireWriter({ ...input(f), backupId: f.staleBackup.backupId }, f.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "BACKUP_SNAPSHOT_MISMATCH" });
  });
});

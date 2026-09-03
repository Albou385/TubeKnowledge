import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createPortabilityBackup } from "./backup-builder";
import { createCheckpoint, latestCheckpoint, readCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { resolveCurrentConflict } from "./conflict-resolution";
import { detectConflicts, loadConflicts } from "./conflicts";
import { keepCurrentAndReacquireExpiredLocalWriter } from "./expired-local-conflict-reacquire";
import { readPortabilityHistory } from "./history";
import { listHandoffs } from "./handoff";
import { ensureMachineIdentity } from "./machine-identity";
import { createVaultSnapshot, persistLatestSnapshot, readLatestSnapshot } from "./snapshots";
import { getPortabilityStatus } from "./status";
import { reacquireWriter } from "./writer-operations";
import { acquireWriterAuthority, readWriterAuthority, writerAuthorityPath } from "./writer-authority";

vi.mock("./one-drive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./one-drive")>();
  const hydratedProbe = async () => ({ offline: false, unpinned: false });
  return { ...actual, probeWindowsAttributes: hydratedProbe, inspectOneDriveLocal: (...args: Parameters<typeof actual.inspectOneDriveLocal>) => actual.inspectOneDriveLocal(args[0], args[1], args[2], args[3] ?? hydratedProbe) };
});

const roots: string[] = [];
const start = new Date("2026-09-03T10:00:00.000Z");
const expiredAt = new Date("2026-09-03T10:02:00.000Z");

async function fixture(options: { backupMachine?: "local" | "other"; extraChange?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-expired-local-conflict-"));
  roots.push(root);
  const oneDrive = path.join(root, "OneDrive");
  const vault = path.join(oneDrive, "vault");
  await mkdir(path.join(vault, "02_SOURCES"), { recursive: true });
  await writeFile(path.join(vault, "INDEX.md"), "# Index\n");
  await writeFile(path.join(vault, "02_SOURCES", "videos.md"), "# Vidéos initiales\n");
  const env = {
    YOUTUBE_LIBRARY_PATH: vault, TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive,
    TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups"),
    TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0", TUBEKNOWLEDGE_WRITER_LEASE_MINUTES: "30", TUBEKNOWLEDGE_MACHINE_NAME: "Portable fixture", TUBEKNOWLEDGE_MACHINE_ROLE: "writer",
  };
  const config = getPortabilityConfig(env);
  const identity = await ensureMachineIdentity(config, { machineId: "11111111-1111-4111-8111-111111111111", now: start });
  const baseline = await createVaultSnapshot(vault, identity.machineId, { now: start });
  await persistLatestSnapshot(config, baseline);
  const checkpoint = await (await import("./checkpoints")).createCheckpoint(vault, baseline, "backup", { now: start });
  await acquireWriterAuthority(vault, identity, checkpoint, 1, { now: start, force: true, verifiedBackupId: randomUUID(), confirmationText: "REPRENDRE" });
  await writeFile(path.join(vault, "02_SOURCES", "videos.md"), "# Vidéos confirmées\n");
  if (options.extraChange) await writeFile(path.join(vault, "INDEX.md"), "# Index modifié\n");
  const backupIdentity = options.backupMachine === "other"
    ? { ...identity, machineId: "22222222-2222-4222-8222-222222222222", displayName: "Autre fixture" }
    : identity;
  const backup = await createPortabilityBackup(vault, config, backupIdentity, "knowledge", { now: expiredAt, wait: async () => undefined, gitCommit: "abcdef0" });
  const conflictId = "33333333-3333-4333-8333-333333333333";
  await writeFile(path.join(config.statePath, "conflicts.json"), `${JSON.stringify([{
    schemaVersion: 1, conflictId, type: "content-divergence", detectedAt: expiredAt.toISOString(), paths: ["02_SOURCES/videos.md"],
    severity: "blocking", status: "open", evidence: { reason: "Modification locale vérifiée" }, baseCheckpointId: checkpoint.checkpointId,
  }], null, 2)}\n`);
  return { root, vault, env, config, identity, baseline, checkpoint, backup, conflictId };
}

function input(f: Awaited<ReturnType<typeof fixture>>, idempotencyKey = randomUUID()) {
  return { conflictId: f.conflictId, backupId: f.backup.backupId, confirmationText: "CONSERVER ET REACQUERIR", idempotencyKey };
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("conserver puis réacquérir un writer local expiré", () => {
  it("1. reproduit le deadlock V1 avant le parcours combiné", async () => {
    const f = await fixture();
    await expect(reacquireWriter({ idempotencyKey: randomUUID(), backupId: f.backup.backupId, confirmationText: "REACQUERIR" }, f.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_REACQUIRE_BLOCKED_BY_CONFLICT" });
    await expect(resolveCurrentConflict(f.conflictId, "resolved", f.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_EXPIRED_LOCAL" });
  });

  it("2. réussit avec le seul conflit admissible et un backup knowledge courant", async () => {
    const f = await fixture();
    await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined })).resolves.toMatchObject({ operation: "expired-local-conflict-reacquire", conflict: { status: "resolved" } });
  });

  it("3. ne modifie pas le Markdown", async () => {
    const f = await fixture(); const target = path.join(f.vault, "02_SOURCES", "videos.md"); const before = await readFile(target);
    await keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined });
    expect(await readFile(target)).toEqual(before);
  });

  it("4. résout uniquement le conflit ciblé", async () => {
    const f = await fixture(); await keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined });
    expect(await loadConflicts(f.config)).toEqual([expect.objectContaining({ conflictId: f.conflictId, status: "resolved" })]);
  });

  it("5. remplace la baseline par le snapshot courant", async () => {
    const f = await fixture(); const result = await keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined });
    expect((await readLatestSnapshot(f.config))?.rootHash).toBe(result.checkpoint.rootHash);
  });

  it("6. crée un checkpoint cohérent avec le conflit", async () => {
    const f = await fixture(); const result = await keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined });
    expect(await latestCheckpoint(f.vault)).toMatchObject({ checkpointId: result.checkpoint.checkpointId, conflictId: f.conflictId, rootHash: result.checkpoint.rootHash });
  });

  it("7. réactive writer sur la même machine", async () => {
    const f = await fixture(); await keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined });
    expect(await readWriterAuthority(f.vault)).toMatchObject({ machineId: f.identity.machineId, status: "active" });
  });

  it("8. ne recrée pas de content-divergence à la vérification suivante", async () => {
    const f = await fixture(); await keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined });
    const snapshot = await createVaultSnapshot(f.vault, f.identity.machineId, { now: expiredAt });
    const conflicts = await detectConflicts(snapshot, f.config, await latestCheckpoint(f.vault), { baseSnapshot: await readLatestSnapshot(f.config) || undefined, writerAuthority: await readWriterAuthority(f.vault) });
    expect(conflicts.filter((item) => item.type === "content-divergence")).toEqual([]);
  });

  it("9. refuse un writer expiré distant", async () => {
    const f = await fixture(); const current = JSON.parse(await readFile(writerAuthorityPath(f.vault), "utf8")); current.machineId = "22222222-2222-4222-8222-222222222222"; await writeFile(writerAuthorityPath(f.vault), JSON.stringify(current));
    await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "EXPIRED_LOCAL_CONFLICT_REACQUIRE_NOT_ALLOWED" });
  });

  it("10. refuse le nouveau chemin si writer est encore actif", async () => {
    const f = await fixture(); await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: new Date("2026-09-03T10:00:30.000Z"), wait: async () => undefined })).rejects.toMatchObject({ code: "EXPIRED_LOCAL_CONFLICT_REACQUIRE_NOT_ALLOWED" });
  });

  it("11. refuse un handoff actif", async () => {
    const f = await fixture(); const handoffId = "44444444-4444-4444-8444-444444444444"; const handoffPath = path.join(f.vault, ".tubeknowledge", "portability", "handoffs", `${handoffId}.json`);
    await mkdir(path.dirname(handoffPath), { recursive: true }); await writeFile(handoffPath, JSON.stringify({ schemaVersion: 1, handoffId, sourceMachineId: f.identity.machineId, sourceDisplayName: "Portable fixture", checkpointId: f.checkpoint.checkpointId, rootHash: f.checkpoint.rootHash, backupId: f.backup.backupId, createdAt: start.toISOString(), expiresAt: new Date("2026-09-03T12:00:00.000Z").toISOString(), status: "prepared" }));
    await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_REACQUIRE_BLOCKED_BY_HANDOFF" }); expect(await listHandoffs(f.vault)).toHaveLength(1);
  });

  it("12. refuse tout autre conflit bloquant", async () => {
    const f = await fixture(); const conflicts = JSON.parse(await readFile(path.join(f.config.statePath, "conflicts.json"), "utf8")); conflicts.push({ ...conflicts[0], conflictId: "55555555-5555-4555-8555-555555555555", paths: ["INDEX.md"] }); await writeFile(path.join(f.config.statePath, "conflicts.json"), JSON.stringify(conflicts));
    await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "CONFLICTS_BLOCKING" });
  });

  it("13. refuse un backup dont le rootHash ne correspond pas", async () => {
    const f = await fixture(); await writeFile(path.join(f.vault, "02_SOURCES", "videos.md"), "# Après backup\n");
    await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "BACKUP_SNAPSHOT_MISMATCH" });
  });

  it("14. refuse un backup créé par une autre machine", async () => {
    const f = await fixture({ backupMachine: "other" }); await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "BACKUP_SNAPSHOT_MISMATCH" });
  });

  it("15. refuse une modification hors des chemins acceptés", async () => {
    const f = await fixture({ extraChange: true }); await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "EXPIRED_LOCAL_CONFLICT_REACQUIRE_NOT_ALLOWED" });
  });

  it("16. est idempotent au replay et n’a qu’un audit", async () => {
    const f = await fixture(); const key = randomUUID(); const first = await keepCurrentAndReacquireExpiredLocalWriter(input(f, key), f.env, { now: expiredAt, wait: async () => undefined }); const replay = await keepCurrentAndReacquireExpiredLocalWriter(input(f, key), f.env, { now: expiredAt, wait: async () => undefined });
    expect(replay).toEqual(first); expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "expired-local-conflict-reacquired")).toHaveLength(1);
  });

  it("17. rollback fail-closed un échec intermédiaire", async () => {
    const f = await fixture(); const beforeAuthority = await readFile(writerAuthorityPath(f.vault), "utf8"); const beforeBaseline = await readLatestSnapshot(f.config);
    await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined, failAt: "after-checkpoint" })).rejects.toMatchObject({ code: "CONTROLLED_STATE_UPDATE_FAILED" });
    expect(await readFile(writerAuthorityPath(f.vault), "utf8")).toBe(beforeAuthority); expect((await readLatestSnapshot(f.config))?.rootHash).toBe(beforeBaseline?.rootHash); expect((await loadConflicts(f.config))[0]?.status).toBe("open");
  });

  it("18. garde les erreurs et l’interface publiques sans chemin ni secret", async () => {
    const f = await fixture(); const source = await readFile(path.join(process.cwd(), "src/components/conflict-resolution-actions.tsx"), "utf8");
    await expect(keepCurrentAndReacquireExpiredLocalWriter({ ...input(f), confirmationText: "NON" }, f.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "EXPIRED_LOCAL_CONFLICT_CONFIRMATION_REQUIRED" });
    expect(source).toContain("CONSERVER ET REACQUERIR"); expect(source).toContain("Conserver le contenu actuel et réactiver l’écriture"); expect(source).not.toContain("TUBEKNOWLEDGE_PORTABILITY_STATE_PATH");
  });

  it.each(["baseline", "checkpoint", "authority", "conflict"] as const)("reprend de façon déterministe après une interruption au jalon %s", async (crashAfter) => {
    const f = await fixture(); const key = randomUUID();
    await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f, key), f.env, { now: expiredAt, wait: async () => undefined, crashAfter })).rejects.toBeInstanceOf(Error);
    if (crashAfter !== "conflict") await expect(getPortabilityStatus(f.env, expiredAt)).resolves.toMatchObject({ writer: { canWrite: false } });
    const result = await keepCurrentAndReacquireExpiredLocalWriter(input(f, key), f.env, { now: expiredAt, wait: async () => undefined });
    expect(result.checkpoint.checkpointId).not.toBe(key);
    expect((await loadConflicts(f.config)).find((item) => item.conflictId === f.conflictId)?.status).toBe("resolved");
    expect((await readWriterAuthority(f.vault))?.authorityId).toBe(result.authority.authorityId);
  });

  it("ne remplace ni ne supprime un checkpoint préexistant en collision", async () => {
    const f = await fixture(); const collision = "66666666-6666-4666-8666-666666666666";
    const existing = await createCheckpoint(f.vault, f.baseline, "backup", { checkpointId: collision, now: new Date(start.getTime() - 1_000) });
    await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined, checkpointId: collision })).rejects.toMatchObject({ code: "PORTABILITY_STATE_INCONSISTENT" });
    expect(await readCheckpoint(f.vault, collision)).toEqual(existing);
    expect(await readFile(writerAuthorityPath(f.vault), "utf8")).toContain(f.checkpoint.checkpointId);
  });

  it("refuse aussi un handoff accepted non expiré", async () => {
    const f = await fixture(); const handoffId = "77777777-7777-4777-8777-777777777777"; const handoffPath = path.join(f.vault, ".tubeknowledge", "portability", "handoffs", `${handoffId}.json`);
    await mkdir(path.dirname(handoffPath), { recursive: true }); await writeFile(handoffPath, JSON.stringify({ schemaVersion: 1, handoffId, sourceMachineId: f.identity.machineId, sourceDisplayName: "Portable fixture", targetMachineId: "88888888-8888-4888-8888-888888888888", checkpointId: f.checkpoint.checkpointId, rootHash: f.checkpoint.rootHash, backupId: f.backup.backupId, createdAt: start.toISOString(), expiresAt: new Date("2026-09-03T12:00:00.000Z").toISOString(), status: "accepted" }));
    await expect(keepCurrentAndReacquireExpiredLocalWriter(input(f), f.env, { now: expiredAt, wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_REACQUIRE_BLOCKED_BY_HANDOFF" });
  });
});

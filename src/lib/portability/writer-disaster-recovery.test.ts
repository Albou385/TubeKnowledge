import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPortabilityBackup } from "./backup-builder";
import { listBackupRecords } from "./backup-reader";
import { checkpointDirectory, createCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { PORTABILITY_METADATA_PATH } from "./constants";
import { readPortabilityHistory } from "./history";
import { listHandoffs, prepareHandoff } from "./handoff";
import { acknowledgeLegacyWriterConflict } from "./legacy-writer-conflict";
import { ensureMachineIdentity } from "./machine-identity";
import { createVaultSnapshot } from "./snapshots";
import { acquireWriterAuthority, readWriterAuthority, writerAuthorityPath } from "./writer-authority";
import { applyWriterDisasterRecovery, discoverPendingWriterDisasterRecovery, previewWriterDisasterRecovery, resumePendingWriterDisasterRecovery } from "./writer-disaster-recovery";

const roots: string[] = [];
const sourceMachineId = "11111111-1111-4111-8111-111111111111";
const portableMachineId = "22222222-2222-4222-8222-222222222222";
const otherPortableMachineId = "55555555-5555-4555-8555-555555555555";
const sourceNow = new Date("2026-09-01T00:00:00.000Z");
const eligibleNow = new Date("2026-09-02T00:31:00.000Z");

async function fixture(options: { localMachineId?: string; backupProfile?: "knowledge" | "full" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-writer-disaster-recovery-"));
  roots.push(root);
  const oneDrive = path.join(root, "OneDrive");
  const vault = path.join(oneDrive, "vault");
  await mkdir(path.join(vault, "01_BIBLIOTHEQUE"), { recursive: true });
  await writeFile(path.join(vault, "INDEX.md"), "# Index\n");
  await writeFile(path.join(vault, "01_BIBLIOTHEQUE", "note.md"), "# Note\n");
  const env = {
    YOUTUBE_LIBRARY_PATH: vault,
    TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive,
    TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state-portable"),
    TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups-portable"),
    TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0",
    TUBEKNOWLEDGE_WRITER_LEASE_MINUTES: "30",
    TUBEKNOWLEDGE_MACHINE_NAME: "Portable",
    TUBEKNOWLEDGE_MACHINE_ROLE: "reader",
  };
  const config = getPortabilityConfig(env);
  const identity = await ensureMachineIdentity(config, { machineId: options.localMachineId || portableMachineId, now: sourceNow });
  const backup = await createPortabilityBackup(vault, config, identity, options.backupProfile || "knowledge", {
    now: sourceNow,
    wait: async () => undefined,
    gitCommit: "abcdef0",
    trigger: "manual-check",
  });
  const sourceIdentity = { schemaVersion: 1 as const, machineId: sourceMachineId, displayName: "Tour perdue", createdAt: sourceNow.toISOString(), rolePreference: "writer" as const };
  const sourceSnapshot = await createVaultSnapshot(vault, sourceMachineId, { now: sourceNow });
  const checkpoint = await createCheckpoint(vault, sourceSnapshot, "backup", { now: sourceNow, backupId: backup.backupId });
  const authority = await acquireWriterAuthority(vault, sourceIdentity, checkpoint, 30, {
    now: sourceNow,
    force: true,
    verifiedBackupId: backup.backupId,
    confirmationText: "REPRENDRE",
  });
  return { root, vault, env, config, identity, backup, checkpoint, authority };
}

async function secondPortable(value: Awaited<ReturnType<typeof fixture>>) {
  const env = {
    ...value.env,
    TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(value.root, "state-other-portable"),
    TUBEKNOWLEDGE_BACKUP_PATH: path.join(value.root, "backups-other-portable"),
    TUBEKNOWLEDGE_MACHINE_NAME: "Autre Portable",
  };
  const config = getPortabilityConfig(env);
  const identity = await ensureMachineIdentity(config, { machineId: otherPortableMachineId, now: sourceNow });
  const backup = await createPortabilityBackup(value.vault, config, identity, "knowledge", {
    now: sourceNow,
    wait: async () => undefined,
    gitCommit: "abcdef0",
    trigger: "manual-check",
  });
  return { env, config, identity, backup };
}

async function checkpointCount(vault: string): Promise<number> {
  return (await readdir(checkpointDirectory(vault))).filter((name) => name.endsWith(".json")).length;
}

function applyInput(recoveryId: string, idempotencyKey = randomUUID()) {
  return { idempotencyKey, recoveryId, confirmationText: "REPRENDRE LE WRITER SUR CE PORTABLE" as const };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("récupération bornée du writer distant expiré", () => {
  it("produit une Preview sans toucher aux connaissances, au checkpoint ou à l’autorité", async () => {
    const f = await fixture();
    const beforeAuthority = await readFile(writerAuthorityPath(f.vault), "utf8");
    const beforeKnowledge = await readFile(path.join(f.vault, "INDEX.md"), "utf8");
    const beforeCheckpoints = await checkpointCount(f.vault);

    const preview = await previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined });

    expect(preview).toMatchObject({ sourceMachineId, machineId: portableMachineId, checkpointId: f.checkpoint.checkpointId, rootHash: f.checkpoint.rootHash, status: "ready" });
    expect(preview.risks.join(" ")).toContain("deux writers");
    expect(await readFile(writerAuthorityPath(f.vault), "utf8")).toBe(beforeAuthority);
    expect(await readFile(path.join(f.vault, "INDEX.md"), "utf8")).toBe(beforeKnowledge);
    expect(await checkpointCount(f.vault)).toBe(beforeCheckpoints);
  });

  it("Apply conserve le checkpoint, crée une autorité locale distincte et un audit unique", async () => {
    const f = await fixture();
    const preview = await previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined });
    const key = randomUUID();
    const beforeCheckpoints = await checkpointCount(f.vault);
    const beforeBackups = (await listBackupRecords(f.config)).length;
    const request = applyInput(preview.recoveryId, key);
    const [first, second] = await Promise.all([
      applyWriterDisasterRecovery(request, f.env, { now: eligibleNow, wait: async () => undefined }),
      applyWriterDisasterRecovery(request, f.env, { now: eligibleNow, wait: async () => undefined }),
    ]);

    expect(second).toEqual(first);
    expect(first).toMatchObject({ operation: "disaster-recovery", sourceMachineId, checkpoint: { checkpointId: f.checkpoint.checkpointId } });
    expect(first.authority.machineId).toBe(portableMachineId);
    expect(first.authority.machineId).not.toBe(sourceMachineId);
    expect(first.authority.authorityId).toBe(key);
    expect((await readWriterAuthority(f.vault))?.machineId).toBe(portableMachineId);
    expect(await checkpointCount(f.vault)).toBe(beforeCheckpoints);
    expect((await listBackupRecords(f.config)).length).toBe(beforeBackups);
    expect(await readFile(path.join(f.vault, "INDEX.md"), "utf8")).toBe("# Index\n");
    expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "writer-disaster-recovered")).toEqual([
      expect.objectContaining({ machineId: portableMachineId, sourceMachineId }),
    ]);
    expect(JSON.stringify(first)).not.toContain(f.root);
  });

  it("n’autorise qu’une intention parmi deux clés concurrentes", async () => {
    const f = await fixture();
    const preview = await previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined });
    const results = await Promise.allSettled([
      applyWriterDisasterRecovery(applyInput(preview.recoveryId), f.env, { now: eligibleNow, wait: async () => undefined }),
      applyWriterDisasterRecovery(applyInput(preview.recoveryId), f.env, { now: eligibleNow, wait: async () => undefined }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "writer-disaster-recovered")).toHaveLength(1);
  });

  it("sérialise deux identités et deux statePath visant le même vault local", async () => {
    const f = await fixture();
    const other = await secondPortable(f);
    const [previewA, previewB] = await Promise.all([
      previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined }),
      previewWriterDisasterRecovery({ backupId: other.backup.backupId }, other.env, { now: eligibleNow, wait: async () => undefined }),
    ]);
    const results = await Promise.allSettled([
      applyWriterDisasterRecovery(applyInput(previewA.recoveryId), f.env, { now: eligibleNow, wait: async () => undefined }),
      applyWriterDisasterRecovery(applyInput(previewB.recoveryId), other.env, { now: eligibleNow, wait: async () => undefined }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")).toHaveLength(1);
    const authority = await readWriterAuthority(f.vault);
    const winner = results.find((item) => item.status === "fulfilled");
    expect(authority?.machineId).toBe(winner?.status === "fulfilled" ? winner.value.authority.machineId : "");
    const events = [
      ...(await readPortabilityHistory(f.config.statePath)),
      ...(await readPortabilityHistory(other.config.statePath)),
    ].filter((item) => item.event === "writer-disaster-recovered");
    expect(events).toHaveLength(1);
  });

  it("sérialise un handoff qui arrive pendant la fenêtre de stabilité d’Apply", async () => {
    const f = await fixture();
    const preview = await previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined });
    const sourceIdentity = { schemaVersion: 1 as const, machineId: sourceMachineId, displayName: "Tour perdue", createdAt: sourceNow.toISOString(), rolePreference: "writer" as const };
    const sourceSnapshot = await createVaultSnapshot(f.vault, sourceMachineId, { now: sourceNow });
    let handoffAttempt: Promise<unknown> | null = null;
    const result = await applyWriterDisasterRecovery(applyInput(preview.recoveryId), f.env, {
      now: eligibleNow,
      wait: async () => {
        handoffAttempt = prepareHandoff(f.vault, sourceIdentity, sourceSnapshot, f.checkpoint, f.backup, { now: new Date("2026-09-01T00:05:00.000Z") });
      },
    });
    expect(result.authority.machineId).toBe(portableMachineId);
    await expect(handoffAttempt).rejects.toMatchObject({ code: "WRITER_ACTIVE_ELSEWHERE" });
    expect((await listHandoffs(f.vault)).filter((item) => item.status === "prepared")).toHaveLength(0);
  });

  it("refuse un writer encore actif, le délai de 24 h non terminé et une identité usurpée", async () => {
    const active = await fixture();
    await expect(previewWriterDisasterRecovery({ backupId: active.backup.backupId }, active.env, { now: new Date("2026-09-01T00:05:00Z"), wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_ACTIVE_REMOTE" });

    const delayed = await fixture();
    await expect(previewWriterDisasterRecovery({ backupId: delayed.backup.backupId }, delayed.env, { now: new Date("2026-09-02T00:29:59Z"), wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_DISASTER_RECOVERY_DELAY_ACTIVE" });

    const impersonated = await fixture({ localMachineId: sourceMachineId });
    await expect(previewWriterDisasterRecovery({ backupId: impersonated.backup.backupId }, impersonated.env, { now: eligibleNow, wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_DISASTER_RECOVERY_NOT_ALLOWED" });
  });

  it("exige zéro conflit ouvert, y compris un warning technique", async () => {
    const f = await fixture();
    const legacy = {
      schemaVersion: 1,
      conflictId: randomUUID(),
      type: "stale-writer-authority",
      detectedAt: eligibleNow.toISOString(),
      paths: [],
      severity: "warning",
      status: "open",
      evidence: { reason: "À examiner" },
    };
    await writeFile(path.join(f.config.statePath, "conflicts.json"), JSON.stringify([legacy]));
    await expect(previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_DISASTER_RECOVERY_CONFLICTS_PRESENT" });
    const rawBefore = await readFile(path.join(f.config.statePath, "conflicts.json"), "utf8");
    await acknowledgeLegacyWriterConflict({
      conflictId: legacy.conflictId,
      idempotencyKey: randomUUID(),
      confirmationText: "CLASSER LE CONFLIT WRITER HISTORIQUE",
    }, f.env, { now: eligibleNow });
    await expect(previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined })).resolves.toMatchObject({ status: "ready" });
    expect(await readFile(path.join(f.config.statePath, "conflicts.json"), "utf8")).toBe(rawBefore);
  });

  it("refuse un vault qui change pendant la fenêtre de stabilité", async () => {
    const f = await fixture();
    await expect(previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, {
      now: eligibleNow,
      wait: async () => writeFile(path.join(f.vault, "INDEX.md"), "# Instable\n"),
    })).rejects.toMatchObject({ code: "VAULT_UNSTABLE" });
    expect((await readWriterAuthority(f.vault))?.machineId).toBe(sourceMachineId);
  });

  it.each([
    ["normal", "handoffs", { schemaVersion: 1, handoffId: "33333333-3333-4333-8333-333333333333", sourceMachineId, sourceDisplayName: "Tour", checkpointId: "CHECKPOINT", rootHash: "ROOT_HASH", backupId: "BACKUP", createdAt: eligibleNow.toISOString(), expiresAt: "2026-09-03T00:31:00.000Z", status: "prepared" }],
    ["absence prolongée", "extended-absence-handoffs", { schemaVersion: 1, kind: "extended-absence", handoffId: "44444444-4444-4444-8444-444444444444", sourceMachineId, sourceDisplayName: "Tour", checkpointId: "CHECKPOINT", rootHash: "ROOT_HASH", backupId: "BACKUP", durationDays: 2, createdAt: eligibleNow.toISOString(), expiresAt: "2026-09-04T00:31:00.000Z", status: "prepared" }],
  ])("refuse un handoff %s actif", async (_label, directory, template) => {
    const f = await fixture();
    const record = JSON.parse(JSON.stringify(template).replace("CHECKPOINT", f.checkpoint.checkpointId).replace("ROOT_HASH", f.checkpoint.rootHash).replace("BACKUP", f.backup.backupId));
    const target = path.join(f.vault, ...PORTABILITY_METADATA_PATH.split("/"), directory, `${record.handoffId}.json`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(record));
    await expect(previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_DISASTER_RECOVERY_HANDOFF_ACTIVE" });
  });

  it("refuse un backup non-knowledge, un rootHash divergent et un checkpoint incohérent", async () => {
    const full = await fixture({ backupProfile: "full" });
    await expect(previewWriterDisasterRecovery({ backupId: full.backup.backupId }, full.env, { now: eligibleNow, wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_DISASTER_RECOVERY_BACKUP_REQUIRED" });

    const divergent = await fixture();
    await writeFile(path.join(divergent.vault, "INDEX.md"), "# Divergent\n");
    await expect(previewWriterDisasterRecovery({ backupId: divergent.backup.backupId }, divergent.env, { now: eligibleNow, wait: async () => undefined })).rejects.toMatchObject({ code: "CHECKPOINT_MISMATCH" });

    const checkpointMismatch = await fixture();
    await writeFile(writerAuthorityPath(checkpointMismatch.vault), JSON.stringify({ ...checkpointMismatch.authority, checkpointId: randomUUID() }));
    await expect(previewWriterDisasterRecovery({ backupId: checkpointMismatch.backup.backupId }, checkpointMismatch.env, { now: eligibleNow, wait: async () => undefined })).rejects.toMatchObject({ code: "CHECKPOINT_MISMATCH" });
  });

  it("refuse un backup knowledge valide mais correspondant à un autre rootHash", async () => {
    const f = await fixture();
    await writeFile(path.join(f.vault, "INDEX.md"), "# Autre état\n");
    const otherBackup = await createPortabilityBackup(f.vault, f.config, f.identity, "knowledge", {
      now: new Date("2026-09-01T12:00:00.000Z"),
      wait: async () => undefined,
      gitCommit: "abcdef0",
      trigger: "manual-check",
    });
    await writeFile(path.join(f.vault, "INDEX.md"), "# Index\n");
    await expect(previewWriterDisasterRecovery({ backupId: otherBackup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_DISASTER_RECOVERY_BACKUP_REQUIRED" });
  });

  it("exige une Preview non expirée et la confirmation exacte", async () => {
    const f = await fixture();
    const preview = await previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined });
    await expect(applyWriterDisasterRecovery({ idempotencyKey: randomUUID(), recoveryId: preview.recoveryId, confirmationText: "REPRENDRE" }, f.env, { now: eligibleNow })).rejects.toMatchObject({ code: "WRITER_DISASTER_RECOVERY_CONFIRMATION_REQUIRED" });
    await expect(applyWriterDisasterRecovery(applyInput(preview.recoveryId), f.env, { now: new Date("2026-09-02T01:01:00.000Z"), wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_DISASTER_RECOVERY_PREVIEW_REQUIRED" });
  });

  it("revérifie l’état après Preview et refuse toute dérive", async () => {
    const f = await fixture();
    const preview = await previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined });
    await writeFile(path.join(f.vault, "INDEX.md"), "# Changement après Preview\n");
    await expect(applyWriterDisasterRecovery(applyInput(preview.recoveryId), f.env, { now: new Date("2026-09-02T00:32:00.000Z"), wait: async () => undefined })).rejects.toMatchObject({ code: "CHECKPOINT_MISMATCH" });
    expect((await readWriterAuthority(f.vault))?.machineId).toBe(sourceMachineId);
  });

  it("restaure l’autorité source si une étape échoue avant l’audit", async () => {
    const f = await fixture();
    const preview = await previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined });
    const key = randomUUID();
    const request = applyInput(preview.recoveryId, key);
    await expect(applyWriterDisasterRecovery(request, f.env, { now: eligibleNow, wait: async () => undefined, failAfterAuthorityWrite: true })).rejects.toThrow("FAIL_AFTER_AUTHORITY_WRITE");
    expect(await readWriterAuthority(f.vault)).toEqual(f.authority);
    expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "writer-disaster-recovered")).toHaveLength(0);

    await expect(applyWriterDisasterRecovery(request, f.env, { now: eligibleNow, wait: async () => undefined })).resolves.toMatchObject({ authority: { machineId: portableMachineId } });
  });

  it("termine idempotemment une interruption après le commit d’autorité et d’audit", async () => {
    const f = await fixture();
    const preview = await previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined });
    const key = randomUUID();
    const request = applyInput(preview.recoveryId, key);
    await expect(applyWriterDisasterRecovery(request, f.env, { now: eligibleNow, wait: async () => undefined, failAfterAuditWrite: true })).rejects.toThrow("FAIL_AFTER_AUDIT_WRITE");
    expect((await readWriterAuthority(f.vault))?.authorityId).toBe(key);

    const replay = await applyWriterDisasterRecovery(request, f.env, { now: new Date("2026-09-02T00:32:00.000Z"), wait: async () => undefined });
    expect(replay.authority.authorityId).toBe(key);
    expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "writer-disaster-recovered")).toHaveLength(1);
  });

  it("découvre et reprend après redémarrage sans réinjecter la clé d’idempotence", async () => {
    const f = await fixture();
    const preview = await previewWriterDisasterRecovery({ backupId: f.backup.backupId }, f.env, { now: eligibleNow, wait: async () => undefined });
    await expect(applyWriterDisasterRecovery(applyInput(preview.recoveryId), f.env, {
      now: eligibleNow,
      wait: async () => undefined,
      simulateCrashAfterAuthorityWrite: true,
    })).rejects.toThrow("SIMULATED_PROCESS_CRASH");
    expect((await readWriterAuthority(f.vault))?.machineId).toBe(portableMachineId);
    expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "writer-disaster-recovered")).toHaveLength(0);

    const discoveredByNewInstance = await discoverPendingWriterDisasterRecovery(f.env);
    expect(discoveredByNewInstance).toMatchObject({ recoveryId: preview.recoveryId, sourceMachineId });
    const resumed = await resumePendingWriterDisasterRecovery({
      recoveryId: discoveredByNewInstance!.recoveryId,
      confirmationText: "REPRENDRE LE WRITER SUR CE PORTABLE",
    }, f.env, { now: new Date("2026-09-02T01:05:00.000Z") });
    expect(resumed.authority.machineId).toBe(portableMachineId);
    expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "writer-disaster-recovered")).toHaveLength(1);
    expect(await discoverPendingWriterDisasterRecovery(f.env)).toBeNull();
  });
});

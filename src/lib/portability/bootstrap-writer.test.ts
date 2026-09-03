import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPortabilityBackup } from "./backup-builder";
import { bootstrapWriter } from "./bootstrap-writer";
import { checkpointDirectory, createCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { readPortabilityHistory } from "./history";
import { ensureMachineIdentity } from "./machine-identity";
import { createVaultSnapshot } from "./snapshots";
import { acquireWriterAuthority, readWriterAuthority } from "./writer-authority";

const roots: string[] = [];
const machineAId = "11111111-1111-4111-8111-111111111111";
const machineBId = "22222222-2222-4222-8222-222222222222";
const fixedNow = new Date("2026-07-23T12:00:00.000Z");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-p6-bootstrap-"));
  roots.push(root);
  const oneDrive = path.join(root, "OneDrive");
  const vault = path.join(oneDrive, "vault");
  await mkdir(path.join(vault, "01_BIBLIOTHEQUE"), { recursive: true });
  await writeFile(path.join(vault, "INDEX.md"), "# Index\n");
  await writeFile(path.join(vault, "01_BIBLIOTHEQUE", "note.md"), "# Note\n");
  const envA = {
    YOUTUBE_LIBRARY_PATH: vault,
    TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive,
    TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state-a"),
    TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups-a"),
    TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0",
    TUBEKNOWLEDGE_MACHINE_NAME: "Tour",
    TUBEKNOWLEDGE_MACHINE_ROLE: "writer",
  };
  const envB = {
    ...envA,
    TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state-b"),
    TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups-b"),
    TUBEKNOWLEDGE_MACHINE_NAME: "Portable",
    TUBEKNOWLEDGE_MACHINE_ROLE: "reader",
  };
  const configA = getPortabilityConfig(envA);
  const configB = getPortabilityConfig(envB);
  const machineA = await ensureMachineIdentity(configA, { machineId: machineAId, now: fixedNow });
  const machineB = await ensureMachineIdentity(configB, { machineId: machineBId, now: fixedNow });
  const backup = await createPortabilityBackup(vault, configA, machineA, "knowledge", {
    now: fixedNow, wait: async () => undefined, appVersion: "test", gitCommit: "abcdef0",
  });
  return { root, vault, envA, envB, configA, configB, machineA, machineB, backup };
}

function input(backupId: string, idempotencyKey = randomUUID()) {
  return { backupId, idempotencyKey, confirmationText: "REPRENDRE" as const };
}

async function checkpointCount(vault: string): Promise<number> {
  try {
    return (await readdir(checkpointDirectory(vault))).filter((name) => name.endsWith(".json")).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

async function bootstrapEventCount(statePath: string): Promise<number> {
  return (await readPortabilityHistory(statePath)).filter((entry) => entry.event === "writer-bootstrap").length;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("bootstrap writer idempotent", () => {
  it("un appel crée un seul checkpoint, une autorité et un événement agrégé", async () => {
    const f = await fixture();
    const result = await bootstrapWriter(input(f.backup.backupId), f.envA, { now: fixedNow, wait: async () => undefined });
    expect(result.outcome).toBe("created");
    expect(result.checkpoint.backupId).toBe(f.backup.backupId);
    expect(await checkpointCount(f.vault)).toBe(1);
    expect((await readWriterAuthority(f.vault))?.authorityId).toBe(result.authority.authorityId);
    expect(await bootstrapEventCount(f.configA.statePath)).toBe(1);
  });

  it("rejoue exactement le même résultat pour la même clé", async () => {
    const f = await fixture();
    const request = input(f.backup.backupId);
    const first = await bootstrapWriter(request, f.envA, { now: fixedNow, wait: async () => undefined });
    const replay = await bootstrapWriter(request, f.envA, { now: fixedNow, wait: async () => undefined });
    expect(replay).toEqual(first);
    expect(await checkpointCount(f.vault)).toBe(1);
    expect(await bootstrapEventCount(f.configA.statePath)).toBe(1);
  });

  it("sérialise deux requêtes concurrentes avec la même clé", async () => {
    const f = await fixture();
    const request = input(f.backup.backupId);
    const [first, second] = await Promise.all([
      bootstrapWriter(request, f.envA, { now: fixedNow, wait: async () => undefined }),
      bootstrapWriter(request, f.envA, { now: fixedNow, wait: async () => undefined }),
    ]);
    expect(second).toEqual(first);
    expect(await checkpointCount(f.vault)).toBe(1);
    expect(await bootstrapEventCount(f.configA.statePath)).toBe(1);
  });

  it("autorise un seul bootstrap avec deux clés concurrentes", async () => {
    const f = await fixture();
    const results = await Promise.allSettled([
      bootstrapWriter(input(f.backup.backupId), f.envA, { now: fixedNow, wait: async () => undefined }),
      bootstrapWriter(input(f.backup.backupId), f.envA, { now: fixedNow, wait: async () => undefined }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((item) => item.status === "rejected")[0]).toMatchObject({ reason: { code: "WRITER_ALREADY_INITIALIZED" } });
    expect(await checkpointCount(f.vault)).toBe(1);
    expect(await bootstrapEventCount(f.configA.statePath)).toBe(1);
  });

  it("refuse un nouveau bootstrap lorsque le writer local est déjà actif", async () => {
    const f = await fixture();
    const first = await bootstrapWriter(input(f.backup.backupId), f.envA, { now: fixedNow, wait: async () => undefined });
    await expect(bootstrapWriter(input(f.backup.backupId), f.envA, { now: new Date("2026-07-23T12:05:00.000Z"), wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_ALREADY_INITIALIZED" });
    expect((await readWriterAuthority(f.vault))?.expiresAt).toBe(first.authority.expiresAt);
    expect(await checkpointCount(f.vault)).toBe(1);
  });

  it("bloque un writer actif sur une autre machine avant toute création", async () => {
    const f = await fixture();
    const snapshot = await createVaultSnapshot(f.vault, f.machineA.machineId, { now: fixedNow });
    const checkpoint = await createCheckpoint(f.vault, snapshot, "backup", { now: fixedNow, backupId: f.backup.backupId });
    await acquireWriterAuthority(f.vault, f.machineA, checkpoint, 30, {
      now: fixedNow, force: true, verifiedBackupId: f.backup.backupId, confirmationText: "REPRENDRE",
    });
    await expect(bootstrapWriter(input(f.backup.backupId), f.envB, { now: fixedNow, wait: async () => undefined }))
      .rejects.toMatchObject({ code: "WRITER_ACTIVE_ELSEWHERE" });
    expect(await checkpointCount(f.vault)).toBe(1);
    expect(await bootstrapEventCount(f.configB.statePath)).toBe(0);
  });

  it("refuse la réutilisation d’une clé pour un autre backup", async () => {
    const f = await fixture();
    const request = input(f.backup.backupId);
    await bootstrapWriter(request, f.envA, { now: fixedNow, wait: async () => undefined });
    const secondBackup = await createPortabilityBackup(f.vault, f.configA, f.machineA, "knowledge", {
      now: fixedNow, wait: async () => undefined, appVersion: "test", gitCommit: "abcdef0",
    });
    await expect(bootstrapWriter({ ...request, backupId: secondBackup.backupId }, f.envA, { now: fixedNow, wait: async () => undefined }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("expire une clé après 24 heures sans recréer de checkpoint", async () => {
    const f = await fixture();
    const request = input(f.backup.backupId);
    await bootstrapWriter(request, f.envA, { now: fixedNow, wait: async () => undefined });
    await expect(bootstrapWriter(request, f.envA, { now: new Date("2026-07-24T12:00:00.001Z"), wait: async () => undefined }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_INVALID" });
    expect(await checkpointCount(f.vault)).toBe(1);
  });

  it("échoue avant checkpoint lorsque le backup est absent", async () => {
    const f = await fixture();
    await expect(bootstrapWriter(input(randomUUID()), f.envA, { now: fixedNow, wait: async () => undefined }))
      .rejects.toMatchObject({ code: "BACKUP_INVALID" });
    expect(await checkpointCount(f.vault)).toBe(0);
    expect(await readWriterAuthority(f.vault)).toBeNull();
  });

  it("refuse un backup dont le rootHash ne correspond plus au vault stable", async () => {
    const f = await fixture();
    await writeFile(path.join(f.vault, "INDEX.md"), "# État modifié\n");
    await expect(bootstrapWriter(input(f.backup.backupId), f.envA, { now: fixedNow, wait: async () => undefined }))
      .rejects.toMatchObject({ code: "BACKUP_SNAPSHOT_MISMATCH" });
    expect(await checkpointCount(f.vault)).toBe(0);
    expect(await readWriterAuthority(f.vault)).toBeNull();
  });

  it("rollback le checkpoint si l’acquisition échoue après sa préparation", async () => {
    const f = await fixture();
    await expect(bootstrapWriter(input(f.backup.backupId), f.envA, {
      now: fixedNow, wait: async () => undefined, failAfterStage: "checkpoint",
    })).rejects.toMatchObject({ code: "WRITER_ACQUISITION_FAILED" });
    expect(await checkpointCount(f.vault)).toBe(0);
    expect(await readWriterAuthority(f.vault)).toBeNull();
    expect(await bootstrapEventCount(f.configA.statePath)).toBe(0);
  });

  it("rollback checkpoint et autorité après une défaillance post-acquisition", async () => {
    const f = await fixture();
    await expect(bootstrapWriter(input(f.backup.backupId), f.envA, {
      now: fixedNow, wait: async () => undefined, failAfterStage: "authority",
    })).rejects.toMatchObject({ code: "WRITER_ACQUISITION_FAILED" });
    expect(await checkpointCount(f.vault)).toBe(0);
    expect(await readWriterAuthority(f.vault)).toBeNull();
    expect(await bootstrapEventCount(f.configA.statePath)).toBe(0);
  });

  it("conserve les anciens checkpoints immuables et refuse de rebootstrapper", async () => {
    const f = await fixture();
    const snapshot = await createVaultSnapshot(f.vault, f.machineA.machineId, { now: fixedNow });
    const oldCheckpoint = await createCheckpoint(f.vault, snapshot, "backup", { now: fixedNow });
    await expect(bootstrapWriter(input(f.backup.backupId), f.envA, {
      now: fixedNow, wait: async () => undefined, failAfterStage: "authority",
    })).rejects.toMatchObject({ code: "WRITER_ALREADY_INITIALIZED" });
    expect(await checkpointCount(f.vault)).toBe(1);
    await expect(readFile(path.join(checkpointDirectory(f.vault), `${oldCheckpoint.checkpointId}.json`), "utf8")).resolves.toContain(oldCheckpoint.checkpointId);
  });

  it("n’expose aucun chemin absolu dans la réponse", async () => {
    const f = await fixture();
    const result = await bootstrapWriter(input(f.backup.backupId), f.envA, { now: fixedNow, wait: async () => undefined });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(f.root);
    expect(serialized).not.toMatch(/[A-Za-z]:[\\/]/);
  });
});

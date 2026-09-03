import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createPortabilityBackup } from "./backup-builder";
import { listBackupRecords } from "./backup-reader";
import { bootstrapWriter } from "./bootstrap-writer";
import { checkpointDirectory, latestCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { readPortabilityHistory } from "./history";
import { ensureMachineIdentity } from "./machine-identity";
import { reacquireWriter, renewWriter } from "./writer-operations";
import { readWriterAuthority } from "./writer-authority";
import { getPortabilityStatus } from "./status";

const roots: string[] = [];
const start = new Date("2026-07-23T12:00:00Z");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-p61-writer-"));
  roots.push(root);
  const oneDrive = path.join(root, "OneDrive");
  const vault = path.join(oneDrive, "vault");
  await mkdir(path.join(vault, "01_BIBLIOTHEQUE"), { recursive: true });
  await writeFile(path.join(vault, "INDEX.md"), "# Index\n");
  await writeFile(path.join(vault, "01_BIBLIOTHEQUE", "note.md"), "# Note\n");
  const env = { YOUTUBE_LIBRARY_PATH: vault, TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups"), TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0", TUBEKNOWLEDGE_WRITER_LEASE_MINUTES: "30", TUBEKNOWLEDGE_MACHINE_NAME: "Tour", TUBEKNOWLEDGE_MACHINE_ROLE: "writer" };
  const config = getPortabilityConfig(env);
  const identity = await ensureMachineIdentity(config, { machineId: "11111111-1111-4111-8111-111111111111", now: start });
  const backup = await createPortabilityBackup(vault, config, identity, "knowledge", { now: start, wait: async () => undefined, gitCommit: "abcdef0", trigger: "bootstrap" });
  const boot = await bootstrapWriter({ idempotencyKey: randomUUID(), backupId: backup.backupId, confirmationText: "REPRENDRE" }, env, { now: start, wait: async () => undefined });
  return { root, vault, env, config, identity, backup, boot };
}

async function checkpointCount(vault: string) {
  return (await readdir(checkpointDirectory(vault))).filter((name) => name.endsWith(".json")).length;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("renew writer", () => {
  it("expose un contrat status cohérent avant et après expiration", async () => {
    const f = await fixture();
    await expect(getPortabilityStatus(f.env, new Date("2026-07-23T12:05:00Z"))).resolves.toMatchObject({ writer: { state: "active-local", status: "active", active: true, leaseValid: true, canWrite: true } });
    await expect(getPortabilityStatus(f.env, new Date("2026-07-23T12:31:00Z"))).resolves.toMatchObject({ writer: { state: "expired-local", status: "expired", active: false, leaseValid: false, initialized: true, canWrite: false, recommendedAction: "reacquire" } });
  });

  it("renouvelle sans backup ni checkpoint et écrit un seul événement", async () => {
    const f = await fixture();
    const key = randomUUID();
    const beforeCheckpoint = await checkpointCount(f.vault);
    const beforeBackups = (await listBackupRecords(f.config)).length;
    const first = await renewWriter(key, f.env, { now: new Date("2026-07-23T12:05:00Z"), wait: async () => undefined });
    const replay = await renewWriter(key, f.env, { now: new Date("2026-07-23T12:06:00Z"), wait: async () => undefined });
    expect(replay).toEqual(first);
    expect(first.checkpointCreated).toBe(false);
    expect(await checkpointCount(f.vault)).toBe(beforeCheckpoint);
    expect((await listBackupRecords(f.config)).length).toBe(beforeBackups);
    expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "writer-renewed")).toHaveLength(1);
  });

  it("sérialise deux renouvellements concurrents avec la même clé", async () => {
    const f = await fixture();
    const key = randomUUID();
    const values = await Promise.all([renewWriter(key, f.env, { now: new Date("2026-07-23T12:05:00Z"), wait: async () => undefined }), renewWriter(key, f.env, { now: new Date("2026-07-23T12:05:00Z"), wait: async () => undefined })]);
    expect(values[1]).toEqual(values[0]);
    expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "writer-renewed")).toHaveLength(1);
  });

  it("refuse un writer expiré et un conflit bloquant", async () => {
    const f = await fixture();
    await expect(renewWriter(randomUUID(), f.env, { now: new Date("2026-07-23T12:31:00Z"), wait: async () => undefined })).rejects.toMatchObject({ code: "WRITER_RENEWAL_NOT_ALLOWED" });
    await writeFile(path.join(f.config.statePath, "conflicts.json"), JSON.stringify([{ schemaVersion: 1, conflictId: randomUUID(), type: "checkpoint-mismatch", detectedAt: start.toISOString(), paths: [], severity: "blocking", status: "open", evidence: { reason: "Mismatch" } }]));
    await expect(renewWriter(randomUUID(), f.env, { now: new Date("2026-07-23T12:05:00Z"), wait: async () => undefined })).rejects.toMatchObject({ code: "PORTABILITY_CONFLICT_BLOCKING" });
  });

  it("refuse un vault instable", async () => {
    const f = await fixture();
    await expect(renewWriter(randomUUID(), f.env, { now: new Date("2026-07-23T12:05:00Z"), wait: async () => writeFile(path.join(f.vault, "INDEX.md"), "# Change\n") })).rejects.toMatchObject({ code: "VAULT_UNSTABLE" });
  });
});

describe("reacquire writer", () => {
  it("réacquiert un writer local expiré sans nouveau checkpoint et rejoue à l’identique", async () => {
    const f = await fixture();
    const key = randomUUID();
    const count = await checkpointCount(f.vault);
    const first = await reacquireWriter({ idempotencyKey: key, backupId: f.backup.backupId, confirmationText: "REACQUERIR" }, f.env, { now: new Date("2026-07-23T12:31:00Z"), wait: async () => undefined });
    const replay = await reacquireWriter({ idempotencyKey: key, backupId: f.backup.backupId, confirmationText: "REACQUERIR" }, f.env, { now: new Date("2026-07-23T12:32:00Z"), wait: async () => undefined });
    expect(replay).toEqual(first);
    expect(first.checkpointCreated).toBe(false);
    expect(await checkpointCount(f.vault)).toBe(count);
    expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "writer-reacquired")).toHaveLength(1);
  });

  it("sérialise la réacquisition concurrente", async () => {
    const f = await fixture();
    const key = randomUUID();
    const input = { idempotencyKey: key, backupId: f.backup.backupId, confirmationText: "REACQUERIR" };
    const values = await Promise.all([reacquireWriter(input, f.env, { now: new Date("2026-07-23T12:31:00Z"), wait: async () => undefined }), reacquireWriter(input, f.env, { now: new Date("2026-07-23T12:31:00Z"), wait: async () => undefined })]);
    expect(values[1]).toEqual(values[0]);
    expect(await checkpointCount(f.vault)).toBe(1);
  });

  it("exige backup et confirmation exacts", async () => {
    const f = await fixture();
    await expect(reacquireWriter({ idempotencyKey: randomUUID(), confirmationText: "REACQUERIR" }, f.env, { now: new Date("2026-07-23T12:31:00Z") })).rejects.toMatchObject({ code: "WRITER_REACQUIRE_BACKUP_REQUIRED" });
    await expect(reacquireWriter({ idempotencyKey: randomUUID(), backupId: f.backup.backupId, confirmationText: "REPRENDRE" }, f.env, { now: new Date("2026-07-23T12:31:00Z") })).rejects.toMatchObject({ code: "WRITER_REACQUIRE_CONFIRMATION_REQUIRED" });
  });

  it("refuse un backup divergent et ne lance jamais de bootstrap", async () => {
    const f = await fixture();
    await writeFile(path.join(f.vault, "INDEX.md"), "# Modifié\n");
    await expect(reacquireWriter({ idempotencyKey: randomUUID(), backupId: f.backup.backupId, confirmationText: "REACQUERIR" }, f.env, { now: new Date("2026-07-23T12:31:00Z"), wait: async () => undefined })).rejects.toMatchObject({ code: "BACKUP_SNAPSHOT_MISMATCH" });
    expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "writer-bootstrap")).toHaveLength(1);
    expect(await latestCheckpoint(f.vault)).toMatchObject({ checkpointId: f.boot.checkpoint.checkpointId });
  });

  it("refuse un conflit de connaissance mais ignore l’ancien conflit technique expiré", async () => {
    const f = await fixture();
    const legacy = { schemaVersion: 1, conflictId: randomUUID(), type: "stale-writer-authority", detectedAt: start.toISOString(), paths: [], severity: "blocking", status: "open", evidence: { reason: "Expiré" } };
    await writeFile(path.join(f.config.statePath, "conflicts.json"), JSON.stringify([legacy]));
    await expect(reacquireWriter({ idempotencyKey: randomUUID(), backupId: f.backup.backupId, confirmationText: "REACQUERIR" }, f.env, { now: new Date("2026-07-23T12:31:00Z"), wait: async () => undefined })).resolves.toMatchObject({ operation: "reacquire" });
  });

  it("ne contient aucun chemin absolu dans le résultat", async () => {
    const f = await fixture();
    const result = await reacquireWriter({ idempotencyKey: randomUUID(), backupId: f.backup.backupId, confirmationText: "REACQUERIR" }, f.env, { now: new Date("2026-07-23T12:31:00Z"), wait: async () => undefined });
    expect(JSON.stringify(result)).not.toContain(f.root);
    expect(await readFile(path.join(f.vault, "INDEX.md"), "utf8")).toBe("# Index\n");
    expect((await readWriterAuthority(f.vault))?.machineId).toBe(f.identity.machineId);
  });
});

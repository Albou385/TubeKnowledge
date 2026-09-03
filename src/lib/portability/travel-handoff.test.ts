import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createCheckpoint } from "./checkpoints";
import type { PortabilityConfig } from "./config";
import { createVaultSnapshot } from "./snapshots";
import {
  acceptExtendedAbsenceHandoff,
  prepareExtendedAbsenceHandoff,
  readExtendedAbsenceHandoff,
} from "./travel-handoff";
import type { BackupRecord, MachineIdentity } from "./types";
import { acquireWriterAuthority, assertWriterAuthority, readWriterAuthority } from "./writer-authority";

const temporary: string[] = [];
const tour: MachineIdentity = { schemaVersion: 1, machineId: "11111111-1111-4111-8111-111111111111", displayName: "Tour", createdAt: "2026-08-12T12:00:00.000Z", rolePreference: "writer" };
const portable: MachineIdentity = { schemaVersion: 1, machineId: "22222222-2222-4222-8222-222222222222", displayName: "Portable", createdAt: "2026-08-12T12:00:00.000Z", rolePreference: "reader" };

afterEach(async () => { await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture(durationDays = 45) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-travel-handoff-"));
  temporary.push(root);
  const vault = path.join(root, "vault");
  await mkdir(vault, { recursive: true });
  await writeFile(path.join(vault, "INDEX.md"), "# Fixture\n", "utf8");
  const snapshot = await createVaultSnapshot(vault, tour.machineId, { now: new Date("2026-08-12T12:00:00.000Z"), attributeProbe: async () => ({ offline: false, unpinned: false, reparsePoint: false }) });
  const checkpoint = await createCheckpoint(vault, snapshot, "backup", { now: new Date("2026-08-12T12:00:00.000Z"), backupId: "33333333-3333-4333-8333-333333333333" });
  await acquireWriterAuthority(vault, tour, checkpoint, 120, {
    now: new Date("2026-08-12T12:00:00.000Z"),
    force: true,
    verifiedBackupId: "33333333-3333-4333-8333-333333333333",
    confirmationText: "REPRENDRE",
  });
  const backup: BackupRecord = {
    backupId: "33333333-3333-4333-8333-333333333333",
    zipPath: path.join(root, "backup.zip"),
    zipSha256: "a".repeat(64),
    zipBytes: 1,
    verified: true,
    verifiedAt: "2026-08-12T12:00:00.000Z",
    pinned: false,
    manifest: {
      schemaVersion: 1,
      backupId: "33333333-3333-4333-8333-333333333333",
      createdAt: "2026-08-12T12:00:00.000Z",
      createdByMachineId: tour.machineId,
      profile: "knowledge",
      sourceSnapshotId: snapshot.snapshotId,
      sourceRootHash: snapshot.rootHash,
      fileCount: snapshot.fileCount,
      totalBytes: snapshot.totalBytes,
      appVersion: "test",
      gitCommit: "test",
      files: snapshot.files.map(({ path: filePath, size, sha256 }) => ({ path: filePath, size, sha256 })),
    },
  };
  const handoff = await prepareExtendedAbsenceHandoff(vault, tour, snapshot, checkpoint, backup, {
    durationDays,
    now: new Date("2026-08-12T12:30:00.000Z"),
  });
  const portableSnapshot = await createVaultSnapshot(vault, portable.machineId, { now: new Date("2026-08-12T12:31:00.000Z"), attributeProbe: async () => ({ offline: false, unpinned: false, reparsePoint: false }) });
  const config: PortabilityConfig = { enabled: true, machineName: "Portable", rolePreference: "reader", statePath: path.join(root, "state"), backupPath: path.join(root, "backups"), stabilityWindowSeconds: 0, writerLeaseMinutes: 60, backupRetentionCount: 10 };
  return { root, vault, snapshot: portableSnapshot, checkpoint, backup, handoff, config };
}

describe("handoff d’absence prolongée", () => {
  it.each([
    ["J+1", 1],
    ["J+30", 30],
    ["juste avant J+60", 60 - 1 / 86_400],
  ])("fait acquérir writer à une nouvelle identité reader à %s", async (_label, days) => {
    const value = await fixture(60);
    const now = new Date(new Date(value.handoff.createdAt).getTime() + days * 24 * 60 * 60 * 1_000);
    const accepted = await acceptExtendedAbsenceHandoff(value.vault, value.handoff.handoffId, portable, value.snapshot, value.config, { now, confirmationText: "ACCEPTER ABSENCE" });
    expect(accepted).toMatchObject({ idempotent: false, handoff: { status: "accepted", targetMachineId: portable.machineId }, authority: { machineId: portable.machineId, status: "active" } });
    await expect(assertWriterAuthority(value.vault, tour, now)).rejects.toMatchObject({ code: "WRITER_ACTIVE_ELSEWHERE" });
  });

  it("refuse exactement à l’expiration et après", async () => {
    const value = await fixture(45);
    await expect(acceptExtendedAbsenceHandoff(value.vault, value.handoff.handoffId, portable, value.snapshot, value.config, {
      now: new Date(value.handoff.expiresAt), confirmationText: "ACCEPTER ABSENCE",
    })).rejects.toMatchObject({ code: "TRAVEL_HANDOFF_EXPIRED" });
    expect((await readWriterAuthority(value.vault))?.status).toBe("released");
  });

  it("consomme une seule fois et rejoue sans créer un deuxième writer", async () => {
    const value = await fixture();
    const now = new Date("2026-09-11T12:30:00.000Z");
    const first = await acceptExtendedAbsenceHandoff(value.vault, value.handoff.handoffId, portable, value.snapshot, value.config, { now, confirmationText: "ACCEPTER ABSENCE" });
    const replay = await acceptExtendedAbsenceHandoff(value.vault, value.handoff.handoffId, portable, value.snapshot, value.config, { now, confirmationText: "ACCEPTER ABSENCE" });
    expect(replay.idempotent).toBe(true);
    expect(replay.authority.authorityId).toBe(first.authority.authorityId);
    const third: MachineIdentity = { ...portable, machineId: "44444444-4444-4444-8444-444444444444", displayName: "Autre" };
    await expect(acceptExtendedAbsenceHandoff(value.vault, value.handoff.handoffId, third, { ...value.snapshot, machineId: third.machineId }, value.config, { now, confirmationText: "ACCEPTER ABSENCE" })).rejects.toMatchObject({ code: "TRAVEL_HANDOFF_CONSUMED" });
  });

  it.each([
    ["rootHash différent", { rootHash: "f".repeat(64) }, {}, "CHECKPOINT_MISMATCH"],
    ["conflit", {}, { blockingConflicts: 1 }, "CONFLICTS_BLOCKING"],
    ["placeholder", {}, { placeholderCount: 1 }, "PLACEHOLDER_DETECTED"],
  ])("refuse %s", async (_label, snapshotChanges, optionChanges, code) => {
    const value = await fixture();
    await expect(acceptExtendedAbsenceHandoff(value.vault, value.handoff.handoffId, portable, { ...value.snapshot, ...snapshotChanges }, value.config, {
      now: new Date("2026-09-11T12:30:00.000Z"), confirmationText: "ACCEPTER ABSENCE", ...optionChanges,
    })).rejects.toMatchObject({ code });
  });

  it("libère immédiatement la Tour et persiste un record sans chemin absolu", async () => {
    const value = await fixture();
    expect((await readWriterAuthority(value.vault))?.status).toBe("released");
    const serialized = await readFile(path.join(value.vault, ".tubeknowledge", "portability", "extended-absence-handoffs", `${value.handoff.handoffId}.json`), "utf8");
    expect(serialized).not.toContain(value.root);
    expect(await readExtendedAbsenceHandoff(value.vault, value.handoff.handoffId)).toMatchObject({ durationDays: 45, status: "prepared" });
  });
});

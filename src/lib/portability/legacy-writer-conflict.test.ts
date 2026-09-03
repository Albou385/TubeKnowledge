import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { checkpointDirectory, createCheckpoint } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { classifyConflict, loadConflicts } from "./conflicts";
import { readPortabilityHistory } from "./history";
import { acknowledgeLegacyWriterConflict } from "./legacy-writer-conflict";
import { ensureMachineIdentity } from "./machine-identity";
import { createVaultSnapshot } from "./snapshots";
import { acquireWriterAuthority, writerAuthorityPath } from "./writer-authority";

const roots: string[] = [];
const conflictId = "33333333-3333-4333-8333-333333333333";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-legacy-writer-conflict-"));
  roots.push(root);
  const oneDrive = path.join(root, "OneDrive");
  const vault = path.join(oneDrive, "vault");
  await mkdir(vault, { recursive: true });
  await writeFile(path.join(vault, "INDEX.md"), "# Index\n");
  const env = {
    YOUTUBE_LIBRARY_PATH: vault,
    TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive,
    TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"),
    TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups"),
    TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0",
    TUBEKNOWLEDGE_MACHINE_NAME: "Portable",
    TUBEKNOWLEDGE_MACHINE_ROLE: "reader",
  };
  const config = getPortabilityConfig(env);
  await ensureMachineIdentity(config, { machineId: "22222222-2222-4222-8222-222222222222", now: new Date("2026-09-02T00:00:00Z") });
  const source = { schemaVersion: 1 as const, machineId: "11111111-1111-4111-8111-111111111111", displayName: "Tour", createdAt: "2026-09-01T00:00:00Z", rolePreference: "writer" as const };
  const snapshot = await createVaultSnapshot(vault, source.machineId, { now: new Date("2026-09-01T00:00:00Z") });
  const checkpoint = await createCheckpoint(vault, snapshot, "backup", { now: new Date("2026-09-01T00:00:00Z") });
  await acquireWriterAuthority(vault, source, checkpoint, 30, { now: new Date("2026-09-01T00:00:00Z"), force: true, verifiedBackupId: randomUUID(), confirmationText: "REPRENDRE" });
  const conflict = { schemaVersion: 1, conflictId, type: "stale-writer-authority", detectedAt: "2026-09-02T00:00:00.000Z", paths: [], severity: "blocking", status: "open", evidence: { reason: "Lease historique expiré" } };
  await writeFile(path.join(config.statePath, "conflicts.json"), `${JSON.stringify([conflict], null, 2)}\n`);
  return { root, vault, env, config };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("classement borné d’un conflit writer historique", () => {
  it("exige le type legacy exact, une confirmation et une clé distincte", async () => {
    const f = await fixture();
    await expect(acknowledgeLegacyWriterConflict({ conflictId, idempotencyKey: randomUUID(), confirmationText: "CLASSER" }, f.env)).rejects.toMatchObject({ code: "CONFLICT_ACTION_NOT_ALLOWED" });
    const raw = JSON.parse(await readFile(path.join(f.config.statePath, "conflicts.json"), "utf8"));
    raw[0].type = "checkpoint-mismatch";
    await writeFile(path.join(f.config.statePath, "conflicts.json"), JSON.stringify(raw));
    await expect(acknowledgeLegacyWriterConflict({ conflictId, idempotencyKey: randomUUID(), confirmationText: "CLASSER LE CONFLIT WRITER HISTORIQUE" }, f.env)).rejects.toMatchObject({ code: "CONFLICT_ACTION_NOT_ALLOWED" });
  });

  it("préserve l’enregistrement original et ne touche ni connaissance, checkpoint ou autorité", async () => {
    const f = await fixture();
    const rawBefore = await readFile(path.join(f.config.statePath, "conflicts.json"), "utf8");
    const knowledgeBefore = await readFile(path.join(f.vault, "INDEX.md"), "utf8");
    const authorityBefore = await readFile(writerAuthorityPath(f.vault), "utf8");
    const checkpointCountBefore = (await readdir(checkpointDirectory(f.vault))).length;
    const key = randomUUID();
    const input = { conflictId, idempotencyKey: key, confirmationText: "CLASSER LE CONFLIT WRITER HISTORIQUE" };
    const [first, replay] = await Promise.all([
      acknowledgeLegacyWriterConflict(input, f.env),
      acknowledgeLegacyWriterConflict(input, f.env),
    ]);
    expect(first.conflict.status).toBe("false-positive");
    expect(replay.conflict.status).toBe("false-positive");
    expect(await readFile(path.join(f.config.statePath, "conflicts.json"), "utf8")).toBe(rawBefore);
    expect(await readFile(path.join(f.vault, "INDEX.md"), "utf8")).toBe(knowledgeBefore);
    expect(await readFile(writerAuthorityPath(f.vault), "utf8")).toBe(authorityBefore);
    expect((await readdir(checkpointDirectory(f.vault))).length).toBe(checkpointCountBefore);
    expect(await loadConflicts(f.config)).toEqual([expect.objectContaining({ conflictId, status: "false-positive" })]);
    expect((await readPortabilityHistory(f.config.statePath)).filter((item) => item.event === "legacy-writer-conflict-acknowledged")).toHaveLength(1);
  });

  it("ne matérialise pas l’overlay legacy lors du classement d’un autre conflit", async () => {
    const f = await fixture();
    await acknowledgeLegacyWriterConflict({ conflictId, idempotencyKey: randomUUID(), confirmationText: "CLASSER LE CONFLIT WRITER HISTORIQUE" }, f.env);
    const rawPath = path.join(f.config.statePath, "conflicts.json");
    const raw = JSON.parse(await readFile(rawPath, "utf8"));
    const otherId = "44444444-4444-4444-8444-444444444444";
    raw.push({ schemaVersion: 1, conflictId: otherId, type: "content-divergence", detectedAt: "2026-09-02T00:00:00.000Z", paths: ["INDEX.md"], severity: "blocking", status: "open", evidence: { reason: "Test" } });
    await writeFile(rawPath, `${JSON.stringify(raw, null, 2)}\n`);

    await classifyConflict(f.config, otherId, "resolved");
    const persisted = JSON.parse(await readFile(rawPath, "utf8"));
    expect(persisted.find((item: { conflictId: string }) => item.conflictId === conflictId).status).toBe("open");
    expect((await loadConflicts(f.config)).find((item) => item.conflictId === conflictId)?.status).toBe("false-positive");
  });
});

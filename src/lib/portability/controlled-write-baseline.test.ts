import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyImport } from "@/lib/imports/apply";
import { previewImport } from "@/lib/imports/preview";
import { packageZip } from "@/lib/imports/test-utils";
import { createPortabilityBackup } from "./backup-builder";
import { applyRestore } from "./restore-apply";
import { previewRestore } from "./restore-preview";
import { createCheckpoint, latestCheckpoint, listCheckpoints } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { resolveCurrentConflict } from "./conflict-resolution";
import { detectConflicts, isBlockingKnowledgeConflict, loadConflicts } from "./conflicts";
import { ensureMachineIdentity } from "./machine-identity";
import { assertPortabilityWriteAllowed } from "./safety-gate";
import { createVaultSnapshot, persistLatestSnapshot, readLatestSnapshot } from "./snapshots";
import { acquireWriterAuthority, advanceWriterCheckpoint, readWriterAuthority } from "./writer-authority";

vi.mock("./one-drive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./one-drive")>();
  const hydratedProbe = async () => ({ offline: false, unpinned: false });
  return {
    ...actual,
    probeWindowsAttributes: hydratedProbe,
    inspectOneDriveLocal: (...args: Parameters<typeof actual.inspectOneDriveLocal>) => actual.inspectOneDriveLocal(args[0], args[1], args[2], args[3] ?? hydratedProbe),
  };
});

const roots: string[] = [];
const start = new Date("2026-07-28T12:00:00Z");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-controlled-baseline-")); roots.push(root);
  const oneDrive = path.join(root, "OneDrive"); const vault = path.join(oneDrive, "vault"); const sessions = path.join(root, "sessions");
  await mkdir(path.join(vault, "00_SYSTEME"), { recursive: true }); await mkdir(path.join(vault, "01_BIBLIOTHEQUE")); await mkdir(path.join(vault, "02_SOURCES")); await mkdir(path.join(vault, "03_A_TRAITER"));
  await writeFile(path.join(vault, "INDEX.md"), "# Index\n"); await writeFile(path.join(vault, "00_SYSTEME", "TAXONOMY.md"), "# Taxonomie\n"); await writeFile(path.join(vault, "01_BIBLIOTHEQUE", "note.md"), "# Original\n"); await writeFile(path.join(vault, "02_SOURCES", "videos.md"), "# Videos\n");
  const env = { YOUTUBE_LIBRARY_PATH: vault, TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups"), TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0", TUBEKNOWLEDGE_MACHINE_NAME: "Tour", TUBEKNOWLEDGE_MACHINE_ROLE: "writer" };
  const config = getPortabilityConfig(env); const identity = await ensureMachineIdentity(config, { machineId: "11111111-1111-4111-8111-111111111111", now: start });
  const snapshot = await createVaultSnapshot(vault, identity.machineId, { now: start }); await persistLatestSnapshot(config, snapshot); const checkpoint = await createCheckpoint(vault, snapshot, "backup", { now: start });
  await acquireWriterAuthority(vault, identity, checkpoint, 60, { now: start, force: true, verifiedBackupId: "fixture", confirmationText: "REPRENDRE" }); await writeFile(path.join(config.statePath, "conflicts.json"), "[]\n");
  return { root, vault, sessions, env, config, identity, snapshot, checkpoint };
}

async function verifyNoContentConflict(f: Awaited<ReturnType<typeof fixture>>) {
  const baseline = await readLatestSnapshot(f.config); const current = await createVaultSnapshot(f.vault, f.identity.machineId); const checkpoint = await latestCheckpoint(f.vault);
  const conflicts = await detectConflicts(current, f.config, checkpoint, { baseSnapshot: baseline || undefined, writerAuthority: await readWriterAuthority(f.vault) });
  expect(conflicts.filter((item) => item.type === "content-divergence" || item.type === "checkpoint-mismatch")).toEqual([]);
}

async function detectExternalChange(f: Awaited<ReturnType<typeof fixture>>, paths: string[]) {
  const current = await createVaultSnapshot(f.vault, f.identity.machineId);
  const conflicts = await detectConflicts(current, f.config, await latestCheckpoint(f.vault), { baseSnapshot: f.snapshot, writerAuthority: await readWriterAuthority(f.vault) });
  for (const relativePath of paths) expect(conflicts.some((item) => item.type === "content-divergence" && item.paths.includes(relativePath))).toBe(true);
  expect(conflicts.some(isBlockingKnowledgeConflict)).toBe(true);
  return conflicts;
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("baseline après écriture contrôlée", () => {
  it("met à jour la baseline après Apply et la vérification locale ne crée aucun faux conflit", async () => {
    const f = await fixture(); const preview = await previewImport(await packageZip(), { environment: f.env, sessionRoot: f.sessions, now: start });
    const result = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.env, sessionRoot: f.sessions, now: new Date("2026-07-28T12:01:00Z"), wait: async () => undefined });
    expect(result.status).toBe("success"); await verifyNoContentConflict(f); await expect(assertPortabilityWriteAllowed(f.env, { now: new Date("2026-07-28T12:02:00Z"), wait: async () => undefined })).resolves.toMatchObject({ enabled: true });
  });

  it("met à jour la baseline après restauration in-place sans fausse divergence", async () => {
    const f = await fixture(); const source = await createPortabilityBackup(f.vault, f.config, f.identity, "knowledge", { now: start, wait: async () => undefined, gitCommit: "abcdef0" });
    await writeFile(path.join(f.vault, "01_BIBLIOTHEQUE", "note.md"), "# Divergent accepté\n"); const divergent = await createVaultSnapshot(f.vault, f.identity.machineId, { now: new Date("2026-07-28T12:01:00Z") }); await persistLatestSnapshot(f.config, divergent); const divergentCheckpoint = await createCheckpoint(f.vault, divergent, "backup", { now: new Date("2026-07-28T12:01:00Z") }); await advanceWriterCheckpoint(f.vault, f.identity, divergentCheckpoint.checkpointId, new Date("2026-07-28T12:01:00Z"));
    const preview = await previewRestore(f.config, { backupId: source.backupId, mode: "restore-in-place", targetRoot: f.vault }, { now: new Date("2026-07-28T12:02:00Z") });
    const result = await applyRestore(f.config, f.env, { restoreId: preview.restoreId, confirmed: true, confirmationText: "RESTAURER" }, { now: new Date("2026-07-28T12:03:00Z"), wait: async () => undefined });
    expect(result.status).toBe("success"); expect(await readFile(path.join(f.vault, "01_BIBLIOTHEQUE", "note.md"), "utf8")).toBe("# Original\n"); await verifyNoContentConflict(f);
  });

  it("continue de bloquer une modification directe hors application", async () => {
    const f = await fixture(); await writeFile(path.join(f.vault, "01_BIBLIOTHEQUE", "note.md"), "# Externe\n"); const conflicts = await detectExternalChange(f, ["01_BIBLIOTHEQUE/note.md"]); expect(conflicts.map((item) => item.type)).toContain("checkpoint-mismatch"); await expect(assertPortabilityWriteAllowed(f.env, { now: start, wait: async () => undefined })).rejects.toMatchObject({ code: "CONFLICTS_BLOCKING" });
  });

  it("la vérification locale n’accepte pas automatiquement une divergence externe comme baseline", async () => {
    const f = await fixture(); await writeFile(path.join(f.vault, "01_BIBLIOTHEQUE", "note.md"), "# Externe vérifié\n");
    for (const [key, value] of Object.entries(f.env)) vi.stubEnv(key, value);
    try {
      const { POST } = await import("@/app/api/portability/snapshot/route"); const response = await POST(new NextRequest("http://localhost/api/portability/snapshot", { method: "POST" }));
      expect(response.status).toBe(200); expect((await readLatestSnapshot(f.config))?.rootHash).toBe(f.snapshot.rootHash); expect((await loadConflicts(f.config)).some((item) => item.type === "content-divergence" && item.status === "open")).toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });

  it("keep-current conserve le Markdown, résout le conflit et ne le recrée pas", async () => {
    const f = await fixture(); const target = path.join(f.vault, "01_BIBLIOTHEQUE", "note.md"); await writeFile(target, "# État actuel\n"); const conflicts = await detectExternalChange(f, ["01_BIBLIOTHEQUE/note.md"]); const conflict = conflicts.find((item) => item.type === "content-divergence")!; const before = await readFile(target, "utf8");
    const result = await resolveCurrentConflict(conflict.conflictId, "resolved", f.env, { now: new Date("2026-07-28T12:01:00Z"), wait: async () => undefined });
    expect(result).toMatchObject({ idempotent: false, requiresPhase3Apply: false, conflict: { status: "resolved" } }); expect(await readFile(target, "utf8")).toBe(before); await verifyNoContentConflict(f);
  });

  it("false-positive est borné et idempotent", async () => {
    const f = await fixture(); await writeFile(path.join(f.vault, "01_BIBLIOTHEQUE", "note.md"), "# Faux positif confirmé\n"); const conflict = (await detectExternalChange(f, ["01_BIBLIOTHEQUE/note.md"])).find((item) => item.type === "content-divergence")!; const beforeCount = (await listCheckpoints(f.vault)).length;
    const first = await resolveCurrentConflict(conflict.conflictId, "false-positive", f.env, { now: new Date("2026-07-28T12:01:00Z"), wait: async () => undefined }); const replay = await resolveCurrentConflict(conflict.conflictId, "false-positive", f.env, { now: new Date("2026-07-28T12:01:00Z"), wait: async () => undefined });
    expect(first.idempotent).toBe(false); expect(replay.idempotent).toBe(true); expect((await listCheckpoints(f.vault)).length).toBe(beforeCount + 1); await verifyNoContentConflict(f);
  });

  it.each(Array.from({ length: 10 }, (_, index) => index + 1))("une double requête keep-current ne crée qu’un checkpoint logique — répétition %i", async () => {
    const f = await fixture(); await writeFile(path.join(f.vault, "01_BIBLIOTHEQUE", "note.md"), "# Double clic\n"); const conflict = (await detectExternalChange(f, ["01_BIBLIOTHEQUE/note.md"])).find((item) => item.type === "content-divergence")!; const beforeCount = (await listCheckpoints(f.vault)).length;
    const results = await Promise.all([resolveCurrentConflict(conflict.conflictId, "resolved", f.env, { now: new Date("2026-07-28T12:01:00Z"), wait: async () => undefined }), resolveCurrentConflict(conflict.conflictId, "resolved", f.env, { now: new Date("2026-07-28T12:01:00Z"), wait: async () => undefined })]);
    expect(results.every((result) => result.conflict.status === "resolved")).toBe(true); expect((await listCheckpoints(f.vault)).length).toBe(beforeCount + 1);
  });

  it("refuse de résoudre un fichier quand un autre conflit bloquant reste ouvert", async () => {
    const f = await fixture(); await writeFile(path.join(f.vault, "INDEX.md"), "# Externe index\n"); await writeFile(path.join(f.vault, "01_BIBLIOTHEQUE", "note.md"), "# Externe note\n"); const conflicts = await detectExternalChange(f, ["INDEX.md", "01_BIBLIOTHEQUE/note.md"]); const target = conflicts.find((item) => item.type === "content-divergence" && item.paths.includes("INDEX.md"))!;
    await expect(resolveCurrentConflict(target.conflictId, "resolved", f.env, { now: start, wait: async () => undefined })).rejects.toMatchObject({ code: "CONFLICTS_BLOCKING" }); expect((await loadConflicts(f.config)).filter((item) => item.type === "content-divergence").every((item) => item.status === "open")).toBe(true);
  });

  it("rollback Apply si la baseline obligatoire ne peut pas être écrite", async () => {
    const f = await fixture(); const beforeCheckpointCount = (await listCheckpoints(f.vault)).length; const beforeAuthority = await readWriterAuthority(f.vault); const preview = await previewImport(await packageZip(), { environment: f.env, sessionRoot: f.sessions, now: start });
    const result = await applyImport({ sessionId: preview.sessionId, confirmed: true }, { environment: f.env, sessionRoot: f.sessions, now: new Date("2026-07-28T12:01:00Z"), wait: async () => undefined, failBaselineWrite: true });
    expect(result.status).toBe("rolled-back"); await expect(readFile(path.join(f.vault, "01_BIBLIOTHEQUE", "Test", "notion.md"), "utf8")).rejects.toThrow(); expect((await readLatestSnapshot(f.config))?.rootHash).toBe(f.snapshot.rootHash); expect((await listCheckpoints(f.vault)).length).toBe(beforeCheckpointCount); expect((await readWriterAuthority(f.vault))?.checkpointId).toBe(beforeAuthority?.checkpointId);
  });
});

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { parseLibraryConfig } from "@/lib/config/library-config";
import { createCheckpoint, listCheckpoints } from "./checkpoints";
import { getPortabilityConfig } from "./config";
import { loadConflicts } from "./conflicts";
import { PortabilityError } from "./errors";
import { atomicWriteJson, windowsPathKey } from "./filesystem";
import { appendPortabilityHistoryOnce } from "./history";
import { loadMachineIdentity } from "./machine-identity";
import { changedKnowledgePaths, createStableSnapshot, latestSnapshotPath, persistLatestSnapshot, readLatestSnapshot } from "./snapshots";
import type { Checkpoint, PortabilityConflict, VaultSnapshot, WriterAuthority } from "./types";
import { advanceWriterCheckpoint, readWriterAuthority, writerAuthorityPath } from "./writer-authority";
import { acquireWriterOperationLock } from "./writer-operation-lock";

export interface ControlledWriteOptions {
  importId?: string;
  restoreId?: string;
  conflictId?: string;
  expectedPaths: string[];
  baseSnapshot: VaultSnapshot;
  conflictStatus?: "resolved" | "false-positive";
  now?: Date;
  wait?: (milliseconds: number) => Promise<void>;
  failBaselineWrite?: boolean;
}

function operationId(action: "import" | "restore" | "conflict-resolved", options: ControlledWriteOptions): string {
  const id = action === "restore" ? options.restoreId : options.importId || options.conflictId;
  if (!id) throw new PortabilityError("CONTROLLED_STATE_UPDATE_FAILED");
  return id;
}

function matchingCheckpoint(checkpoint: Checkpoint, action: "import" | "restore" | "conflict-resolved", options: ControlledWriteOptions): boolean {
  if (checkpoint.action !== action) return false;
  if (options.importId) return checkpoint.importId === options.importId;
  if (options.restoreId) return checkpoint.restoreId === options.restoreId;
  return Boolean(options.conflictId && checkpoint.conflictId === options.conflictId);
}

function assertOnlyExpectedChanges(base: VaultSnapshot, current: VaultSnapshot, expectedPaths: string[]): void {
  const actual = changedKnowledgePaths(base, current).map(windowsPathKey);
  const expected = [...new Set(expectedPaths.map(windowsPathKey))].sort((a, b) => a.localeCompare(b, "en"));
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) throw new PortabilityError("CONTROLLED_WRITE_SCOPE_CHANGED");
}

async function restoreMutableState(input: {
  config: ReturnType<typeof getPortabilityConfig>;
  libraryPath: string;
  baseline: VaultSnapshot | null;
  authority: WriterAuthority;
  conflicts?: PortabilityConflict[];
}): Promise<void> {
  if (input.baseline) await persistLatestSnapshot(input.config, input.baseline);
  else await rm(latestSnapshotPath(input.config), { force: true });
  await atomicWriteJson(writerAuthorityPath(input.libraryPath), input.authority);
  if (input.conflicts) await atomicWriteJson(path.join(input.config.statePath, "conflicts.json"), input.conflicts);
}

export async function recordSuccessfulKnowledgeWrite(
  action: "import" | "restore" | "conflict-resolved",
  environment: LibraryEnvironment,
  options: ControlledWriteOptions,
): Promise<Checkpoint | null> {
  const config = getPortabilityConfig(environment);
  if (!config.enabled) return null;
  const library = parseLibraryConfig(environment);
  if (!library.ok) throw new PortabilityError("VAULT_UNAVAILABLE");
  const identity = await loadMachineIdentity(config);
  if (!identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const id = operationId(action, options);
  const lock = await acquireWriterOperationLock(config, id);
  try {
    const baseline = await readLatestSnapshot(config);
    const authority = await readWriterAuthority(library.rootPath);
    if (!authority) throw new PortabilityError("WRITER_AUTHORITY_REQUIRED");
    const replay = (await listCheckpoints(library.rootPath)).find((checkpoint) => matchingCheckpoint(checkpoint, action, options));
    if (replay) {
      if (baseline?.rootHash !== replay.rootHash || authority.checkpointId !== replay.checkpointId) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
      return replay;
    }

    const snapshot = await createStableSnapshot(library.rootPath, identity.machineId, config.stabilityWindowSeconds, { now: options.now, wait: options.wait });
    assertOnlyExpectedChanges(options.baseSnapshot, snapshot, options.expectedPaths);
    const checkpointId = randomUUID();
    let previousConflicts: PortabilityConflict[] | undefined;
    let nextConflicts: PortabilityConflict[] | undefined;
    if (options.conflictId) {
      previousConflicts = await loadConflicts(config);
      const target = previousConflicts.find((item) => item.conflictId === options.conflictId);
      if (!target || target.status !== "open") throw new PortabilityError("CONFLICT_ACTION_NOT_ALLOWED");
      const status = options.conflictStatus || "resolved";
      nextConflicts = previousConflicts.map((item) => item.conflictId === options.conflictId ? { ...item, status } : item);
    }

    let committed = false;
    try {
      if (options.failBaselineWrite) throw new PortabilityError("CONTROLLED_STATE_UPDATE_FAILED");
      await persistLatestSnapshot(config, snapshot);
      await advanceWriterCheckpoint(library.rootPath, identity, checkpointId, options.now);
      if (nextConflicts) await atomicWriteJson(path.join(config.statePath, "conflicts.json"), nextConflicts);
      const checkpoint = await createCheckpoint(library.rootPath, snapshot, action, {
        checkpointId,
        importId: options.importId,
        restoreId: options.restoreId,
        conflictId: options.conflictId,
        now: options.now,
      });
      committed = true;
      await appendPortabilityHistoryOnce(config.statePath, {
        schemaVersion: 1,
        eventId: id,
        event: "checkpoint-created",
        timestamp: checkpoint.createdAt,
        machineId: identity.machineId,
        relatedId: checkpoint.checkpointId,
        status: action,
      }).catch(() => undefined);
      return checkpoint;
    } catch (error) {
      if (committed) throw error;
      try { await restoreMutableState({ config, libraryPath: library.rootPath, baseline, authority, conflicts: previousConflicts }); }
      catch (rollbackError) { throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: rollbackError }); }
      throw error instanceof PortabilityError ? error : new PortabilityError("CONTROLLED_STATE_UPDATE_FAILED", { cause: error });
    }
  } finally {
    await lock.release();
  }
}

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { getPortabilityConfig } from "./config";
import { loadConflicts } from "./conflicts";
import { PortabilityError } from "./errors";
import { recordSuccessfulKnowledgeWrite } from "./integration";
import { readLatestSnapshot } from "./snapshots";
import { assertPortabilityWriteAllowed } from "./safety-gate";
import type { PortabilityConflict } from "./types";

export interface CurrentConflictResolution {
  conflict: PortabilityConflict;
  idempotent: boolean;
  requiresPhase3Apply: false;
}

export async function resolveCurrentConflict(
  conflictId: string,
  status: "resolved" | "false-positive",
  environment: LibraryEnvironment = process.env,
  options: { now?: Date; wait?: (milliseconds: number) => Promise<void> } = {},
): Promise<CurrentConflictResolution> {
  const config = getPortabilityConfig(environment);
  const existing = (await loadConflicts(config)).find((item) => item.conflictId === conflictId);
  if (!existing) throw new PortabilityError("CONFLICT_ACTION_NOT_ALLOWED");
  if (existing.status === status) return { conflict: existing, idempotent: true, requiresPhase3Apply: false };
  if (existing.status !== "open" || existing.type !== "content-divergence" || existing.paths.length === 0) throw new PortabilityError("CONFLICT_ACTION_NOT_ALLOWED");
  const baseline = await readLatestSnapshot(config);
  if (!baseline) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  await assertPortabilityWriteAllowed(environment, { allowConflictId: conflictId, now: options.now, wait: options.wait });
  await recordSuccessfulKnowledgeWrite("conflict-resolved", environment, {
    conflictId,
    conflictStatus: status,
    expectedPaths: existing.paths,
    baseSnapshot: baseline,
    now: options.now,
    wait: options.wait,
  });
  const resolved = (await loadConflicts(config)).find((item) => item.conflictId === conflictId);
  if (!resolved || resolved.status !== status) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  return { conflict: resolved, idempotent: false, requiresPhase3Apply: false };
}

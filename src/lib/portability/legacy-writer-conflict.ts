import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { getPortabilityConfig, type PortabilityConfig } from "./config";
import { PortabilityError } from "./errors";
import { atomicWriteJson } from "./filesystem";
import { appendPortabilityHistoryOnce } from "./history";
import { loadMachineIdentity } from "./machine-identity";
import type { PortabilityConflict } from "./types";
import { acquireWriterOperationLock } from "./writer-operation-lock";

const uuid = z.string().uuid();
const acknowledgementSchema = z.object({
  schemaVersion: z.literal(1),
  conflictId: uuid,
  idempotencyKey: uuid,
  machineId: uuid,
  acknowledgedAt: z.iso.datetime(),
  originalDetectedAt: z.iso.datetime(),
  classification: z.literal("false-positive"),
  reason: z.literal("legacy-writer-expiry-information"),
}).strict();
const operationSchema = z.object({
  schemaVersion: z.literal(1),
  idempotencyKey: uuid,
  conflictId: uuid,
  machineId: uuid,
  createdAt: z.iso.datetime(),
  status: z.enum(["in-progress", "success"]),
}).strict();

export const legacyWriterConflictAcknowledgementRequestSchema = z.object({
  confirmationText: z.literal("CLASSER LE CONFLIT WRITER HISTORIQUE"),
}).strict();

function root(config: PortabilityConfig): string {
  return path.join(config.statePath, "legacy-writer-conflict-acknowledgements");
}

function acknowledgementPath(config: PortabilityConfig, conflictId: string): string {
  return path.join(root(config), "by-conflict", `${uuid.parse(conflictId)}.json`);
}

function operationPath(config: PortabilityConfig, idempotencyKey: string): string {
  return path.join(root(config), "operations", `${uuid.parse(idempotencyKey)}.json`);
}

async function readOptional<T>(target: string, schema: z.ZodType<T>): Promise<T | null> {
  try { return schema.parse(JSON.parse(await readFile(target, "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: error });
  }
}

async function readRawConflicts(config: PortabilityConfig): Promise<PortabilityConflict[]> {
  try { return JSON.parse(await readFile(path.join(config.statePath, "conflicts.json"), "utf8")) as PortabilityConflict[]; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function listAcknowledgements(config: PortabilityConfig): Promise<Array<z.infer<typeof acknowledgementSchema>>> {
  const directory = path.join(root(config), "by-conflict");
  try {
    const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
    return await Promise.all(names.map(async (name) => acknowledgementSchema.parse(JSON.parse(await readFile(path.join(directory, name), "utf8")))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: error });
  }
}

export async function applyLegacyWriterConflictAcknowledgements(
  config: PortabilityConfig,
  conflicts: PortabilityConflict[],
): Promise<PortabilityConflict[]> {
  const acknowledged = new Set((await listAcknowledgements(config)).map((item) => item.conflictId));
  return conflicts.map((item) => item.type === "stale-writer-authority" && acknowledged.has(item.conflictId)
    ? { ...item, status: "false-positive" }
    : item);
}

export async function acknowledgeLegacyWriterConflict(
  input: { conflictId: string; idempotencyKey: string; confirmationText?: string },
  environment: LibraryEnvironment = process.env,
  options: { now?: Date; lockWait?: (milliseconds: number) => Promise<void> } = {},
): Promise<{ conflict: PortabilityConflict; idempotent: boolean }> {
  const conflictId = uuid.parse(input.conflictId);
  const idempotencyKey = uuid.parse(input.idempotencyKey);
  if (input.confirmationText !== "CLASSER LE CONFLIT WRITER HISTORIQUE") throw new PortabilityError("CONFLICT_ACTION_NOT_ALLOWED");
  const config = getPortabilityConfig(environment);
  const identity = await loadMachineIdentity(config);
  if (!config.enabled || !identity) throw new PortabilityError("PORTABILITY_NOT_CONFIGURED");
  const now = options.now || new Date();
  const lock = await acquireWriterOperationLock(config, idempotencyKey, options.lockWait);
  try {
    const prior = await readOptional(operationPath(config, idempotencyKey), operationSchema);
    if (prior && (prior.conflictId !== conflictId || prior.machineId !== identity.machineId)) throw new PortabilityError("IDEMPOTENCY_CONFLICT");
    const conflict = (await readRawConflicts(config)).find((item) => item.conflictId === conflictId);
    if (!conflict
      || conflict.type !== "stale-writer-authority"
      || conflict.paths.length !== 0
      || !["open", "false-positive"].includes(conflict.status)) throw new PortabilityError("CONFLICT_ACTION_NOT_ALLOWED");
    const existing = await readOptional(acknowledgementPath(config, conflictId), acknowledgementSchema);
    if (existing) {
      if (existing.machineId !== identity.machineId) throw new PortabilityError("CONFLICT_ACTION_NOT_ALLOWED");
      await appendPortabilityHistoryOnce(config.statePath, { schemaVersion: 1, eventId: existing.idempotencyKey, event: "legacy-writer-conflict-acknowledged", timestamp: existing.acknowledgedAt, machineId: existing.machineId, relatedId: conflictId, status: "false-positive" });
      if (!prior || prior.status !== "success") await atomicWriteJson(operationPath(config, idempotencyKey), operationSchema.parse({ schemaVersion: 1, idempotencyKey, conflictId, machineId: identity.machineId, createdAt: now.toISOString(), status: "success" }));
      return { conflict: { ...conflict, status: "false-positive" }, idempotent: true };
    }
    const operation = prior || operationSchema.parse({ schemaVersion: 1, idempotencyKey, conflictId, machineId: identity.machineId, createdAt: now.toISOString(), status: "in-progress" });
    if (!prior) await atomicWriteJson(operationPath(config, idempotencyKey), operation, true);
    const acknowledgement = acknowledgementSchema.parse({
      schemaVersion: 1,
      conflictId,
      idempotencyKey,
      machineId: identity.machineId,
      acknowledgedAt: operation.createdAt,
      originalDetectedAt: conflict.detectedAt,
      classification: "false-positive",
      reason: "legacy-writer-expiry-information",
    });
    await atomicWriteJson(acknowledgementPath(config, conflictId), acknowledgement, true);
    await appendPortabilityHistoryOnce(config.statePath, { schemaVersion: 1, eventId: idempotencyKey, event: "legacy-writer-conflict-acknowledged", timestamp: operation.createdAt, machineId: identity.machineId, relatedId: conflictId, status: "false-positive" });
    await atomicWriteJson(operationPath(config, idempotencyKey), operationSchema.parse({ ...operation, status: "success" }));
    return { conflict: { ...conflict, status: "false-positive" }, idempotent: false };
  } finally {
    await lock.release();
  }
}

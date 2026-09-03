import { createHash, randomUUID } from "node:crypto";
import { readFile, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { atomicWriteJson } from "./filesystem";

const uuid = z.string().uuid();
const hostId = createHash("sha256").update(`${os.hostname()}\0${process.platform}\0${process.arch}`).digest("hex");
const processInstanceId = randomUUID();
const markerHeartbeatMs = 5_000;
export const processInstanceMarkerStaleMs = 30_000;

export const processOwnerSchema = z.object({
  hostId: z.string().regex(/^[a-f0-9]{64}$/),
  processId: z.number().int().positive(),
  processInstanceId: uuid,
}).strict();

const markerSchema = processOwnerSchema.extend({
  schemaVersion: z.literal(1),
  createdAt: z.iso.datetime(),
}).strict();

export type ProcessOwner = z.infer<typeof processOwnerSchema>;
export type ProcessOwnerState = "active-local" | "abandoned-local" | "unknown-local" | "foreign";

const owner: ProcessOwner = { hostId, processId: process.pid, processInstanceId };
const markerPath = path.join(os.tmpdir(), "TubeKnowledge", "portability", "process-instances", hostId, `${process.pid}-${processInstanceId}.json`);
let markerReady: Promise<void> | null = null;

function processIsAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function localProcessOwner(): ProcessOwner {
  return owner;
}

export function processInstanceMarkerPath(value: ProcessOwner): string {
  return path.join(os.tmpdir(), "TubeKnowledge", "portability", "process-instances", value.hostId, `${value.processId}-${value.processInstanceId}.json`);
}

export async function ensureLocalProcessInstanceMarker(): Promise<ProcessOwner> {
  if (!markerReady) {
    markerReady = (async () => {
      await atomicWriteJson(markerPath, markerSchema.parse({ ...owner, schemaVersion: 1, createdAt: new Date().toISOString() }));
      const timer = setInterval(() => {
        const now = new Date();
        void utimes(markerPath, now, now).catch(() => undefined);
      }, markerHeartbeatMs);
      timer.unref();
    })().catch((error) => {
      markerReady = null;
      throw error;
    });
  }
  await markerReady;
  try {
    markerSchema.parse(JSON.parse(await readFile(markerPath, "utf8")));
  } catch {
    await atomicWriteJson(markerPath, markerSchema.parse({ ...owner, schemaVersion: 1, createdAt: new Date().toISOString() }));
  }
  const now = new Date();
  await utimes(markerPath, now, now);
  return owner;
}

export async function inspectProcessOwner(value: ProcessOwner, now = Date.now()): Promise<ProcessOwnerState> {
  const parsed = processOwnerSchema.parse(value);
  if (parsed.hostId !== hostId) return "foreign";
  const alive = processIsAlive(parsed.processId);
  if (!alive) return "abandoned-local";
  try {
    const target = processInstanceMarkerPath(parsed);
    const marker = markerSchema.parse(JSON.parse(await readFile(target, "utf8")));
    if (marker.processInstanceId !== parsed.processInstanceId || marker.processId !== parsed.processId || marker.hostId !== parsed.hostId) return "abandoned-local";
    if (now - (await stat(target)).mtimeMs > processInstanceMarkerStaleMs) return "unknown-local";
    return "active-local";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "unknown-local";
    return "unknown-local";
  }
}

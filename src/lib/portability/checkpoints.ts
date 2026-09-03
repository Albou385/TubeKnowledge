import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { PORTABILITY_METADATA_PATH } from "./constants";
import { atomicWriteJson } from "./filesystem";
import type { Checkpoint, VaultSnapshot } from "./types";

const schema = z.object({ schemaVersion: z.literal(1), checkpointId: z.string().uuid(), rootHash: z.string().regex(/^[a-f0-9]{64}$/), machineId: z.string().uuid(), action: z.enum(["import", "restore", "conflict-resolved", "handoff", "backup"]), createdAt: z.iso.datetime(), importId: z.string().uuid().optional(), restoreId: z.string().uuid().optional(), conflictId: z.string().uuid().optional(), backupId: z.string().uuid().optional() }).strict();
export function checkpointDirectory(vaultPath: string): string { return path.join(vaultPath, ...PORTABILITY_METADATA_PATH.split("/"), "checkpoints"); }

export async function createCheckpoint(vaultPath: string, snapshot: VaultSnapshot, action: Checkpoint["action"], options: { now?: Date; checkpointId?: string; importId?: string; restoreId?: string; conflictId?: string; backupId?: string } = {}): Promise<Checkpoint> {
  const checkpoint = schema.parse({ schemaVersion: 1, checkpointId: options.checkpointId || randomUUID(), rootHash: snapshot.rootHash, machineId: snapshot.machineId, action, createdAt: (options.now || new Date()).toISOString(), importId: options.importId, restoreId: options.restoreId, conflictId: options.conflictId, backupId: options.backupId });
  const directory = checkpointDirectory(vaultPath); await mkdir(directory, { recursive: true });
  await atomicWriteJson(path.join(directory, `${checkpoint.checkpointId}.json`), checkpoint, true); return checkpoint;
}

export async function readCheckpoint(vaultPath: string, checkpointId: string): Promise<Checkpoint> { return schema.parse(JSON.parse(await readFile(path.join(checkpointDirectory(vaultPath), `${z.string().uuid().parse(checkpointId)}.json`), "utf8"))); }
export async function listCheckpoints(vaultPath: string): Promise<Checkpoint[]> {
  try {
    const entries = await readdir(checkpointDirectory(vaultPath));
    const values = await Promise.all(entries.filter((name) => name.endsWith(".json")).map((name) => readFile(path.join(checkpointDirectory(vaultPath), name), "utf8").then((value) => schema.parse(JSON.parse(value)))));
    return values.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export async function latestCheckpoint(vaultPath: string): Promise<Checkpoint | null> {
  return (await listCheckpoints(vaultPath))[0] || null;
}


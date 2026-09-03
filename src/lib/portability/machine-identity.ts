import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { PortabilityConfig } from "./config";
import { atomicWriteJson } from "./filesystem";
import { appendPortabilityHistory } from "./history";
import type { MachineIdentity, MachineRole } from "./types";

const identitySchema = z.object({ schemaVersion: z.literal(1), machineId: z.string().uuid(), displayName: z.string().trim().min(1).max(80), createdAt: z.iso.datetime(), rolePreference: z.enum(["writer", "reader"]) }).strict();
export function machineIdentityPath(statePath: string): string { return path.join(statePath, "machine.json"); }

export async function loadMachineIdentity(config: PortabilityConfig): Promise<MachineIdentity | null> {
  try { return identitySchema.parse(JSON.parse(await readFile(machineIdentityPath(config.statePath), "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

export async function ensureMachineIdentity(config: PortabilityConfig, options: { displayName?: string; rolePreference?: MachineRole; now?: Date; machineId?: string } = {}): Promise<MachineIdentity> {
  const existing = await loadMachineIdentity(config);
  if (existing) return existing;
  const identity = identitySchema.parse({ schemaVersion: 1, machineId: options.machineId || randomUUID(), displayName: options.displayName || config.machineName, createdAt: (options.now || new Date()).toISOString(), rolePreference: options.rolePreference || config.rolePreference });
  await mkdir(config.statePath, { recursive: true });
  await atomicWriteJson(machineIdentityPath(config.statePath), identity, true);
  await appendPortabilityHistory(config.statePath, { schemaVersion: 1, eventId: randomUUID(), event: "machine-configured", timestamp: identity.createdAt, machineId: identity.machineId });
  return identity;
}

export async function updateMachineIdentity(config: PortabilityConfig, changes: { displayName?: string; rolePreference?: MachineRole }): Promise<MachineIdentity> {
  const current = await loadMachineIdentity(config); if (!current) throw new Error("Identité machine absente.");
  const next = identitySchema.parse({ ...current, ...changes }); await atomicWriteJson(machineIdentityPath(config.statePath), next); return next;
}


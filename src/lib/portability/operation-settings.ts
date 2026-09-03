import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { PortabilityConfig } from "./config";
import { PORTABILITY_LIMITS } from "./constants";
import { atomicWriteJson } from "./filesystem";

const schema = z.object({
  schemaVersion: z.literal(1),
  singleMachineMode: z.boolean(),
  renewalReminderMinutes: z.number().int().min(1).max(1440),
  updatedAt: z.iso.datetime(),
}).strict();

export type OperationSettings = z.infer<typeof schema>;

export async function loadOperationSettings(config: PortabilityConfig): Promise<OperationSettings> {
  try {
    return schema.parse(JSON.parse(await readFile(path.join(config.statePath, "operation-settings.json"), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      schemaVersion: 1,
      singleMachineMode: false,
      renewalReminderMinutes: PORTABILITY_LIMITS.defaultRenewalReminderMinutes,
      updatedAt: new Date(0).toISOString(),
    };
  }
}

export async function saveOperationSettings(config: PortabilityConfig, input: { singleMachineMode: boolean; renewalReminderMinutes: number }, now = new Date()): Promise<OperationSettings> {
  const settings = schema.parse({ schemaVersion: 1, ...input, updatedAt: now.toISOString() });
  await atomicWriteJson(path.join(config.statePath, "operation-settings.json"), settings);
  return settings;
}

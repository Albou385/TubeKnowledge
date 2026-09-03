import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

export type PortabilityEventType = "machine-configured" | "diagnostic-run" | "snapshot-created" | "checkpoint-created" | "writer-acquired" | "writer-bootstrap" | "writer-renewed" | "writer-reacquired" | "expired-local-conflict-reacquired" | "stale-baseline-reconciled" | "writer-disaster-recovered" | "writer-released" | "handoff-created" | "handoff-prepared" | "handoff-accepted" | "handoff-rejected" | "conflict-detected" | "conflict-resolved" | "legacy-writer-conflict-acknowledged" | "backup-created" | "backup-verified" | "backup-failed" | "restore-previewed" | "restore-staging" | "restore-in-place" | "restore-success" | "restore-failed" | "restore-rolled-back" | "retention-cleaned";
export interface PortabilityHistoryEntry { schemaVersion: 1; eventId: string; event: PortabilityEventType; timestamp: string; machineId?: string; sourceMachineId?: string; relatedId?: string; status?: string; relativePaths?: string[] }

export async function appendPortabilityHistory(statePath: string, entry: PortabilityHistoryEntry): Promise<void> {
  const serialized = JSON.stringify(entry);
  if (serialized.includes("C:\\") || serialized.includes(statePath)) throw new Error("L’historique de portabilité contient un chemin absolu.");
  await mkdir(statePath, { recursive: true });
  await appendFile(path.join(statePath, "history.jsonl"), `${serialized}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function appendPortabilityHistoryOnce(statePath: string, entry: PortabilityHistoryEntry): Promise<void> {
  if ((await readPortabilityHistory(statePath)).some((existing) => existing.eventId === entry.eventId)) return;
  await appendPortabilityHistory(statePath, entry);
}

export async function readPortabilityHistory(statePath: string): Promise<PortabilityHistoryEntry[]> {
  try { return (await readFile(path.join(statePath, "history.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as PortabilityHistoryEntry).reverse(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
}


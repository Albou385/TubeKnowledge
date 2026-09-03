import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { getRuntimeLocation } from "@/lib/transcription/runtime-location";

import type { LibraryAssistantAnswer } from "./assistant";
import { assistantHistoryIdSchema } from "./schema";

const historySchema = z.object({
  schemaVersion: z.literal(1),
  historyId: z.string().uuid(),
  question: z.string().min(1).max(500),
  createdAt: z.string().datetime({ offset: true }),
  references: z.array(z.string().min(1).max(500)).max(12),
  provider: z.enum(["extractive", "mock"]),
  status: z.enum(["completed", "no-result"]),
}).strict();
export type AssistantHistoryRecord = z.infer<typeof historySchema>;

export function assistantHistoryPath(environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(getRuntimeLocation(environment).runtimePath, "library-assistant", "history");
}

export async function recordAssistantHistory(answer: LibraryAssistantAnswer, root = assistantHistoryPath(), now = new Date()): Promise<AssistantHistoryRecord> {
  const record = historySchema.parse({ schemaVersion: 1, historyId: randomUUID(), question: answer.question, createdAt: now.toISOString(), references: answer.documentsUsed, provider: answer.provider, status: answer.citations.length ? "completed" : "no-result" });
  await mkdir(root, { recursive: true });
  const target = path.join(root, `${record.historyId}.json`);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(temporary, target);
  return record;
}

export async function listAssistantHistory(root = assistantHistoryPath()): Promise<AssistantHistoryRecord[]> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const records: AssistantHistoryRecord[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) continue;
    try {
      const target = path.join(root, entry.name); const details = await lstat(target);
      if (details.isSymbolicLink()) continue;
      records.push(historySchema.parse(JSON.parse(await readFile(target, "utf8"))));
    } catch { /* Entrée corrompue ignorée. */ }
  }
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function deleteAssistantHistory(id: string, confirmed: boolean, root = assistantHistoryPath()): Promise<void> {
  if (!confirmed) throw new Error("Confirmation explicite requise.");
  const valid = assistantHistoryIdSchema.parse(id);
  await rm(path.join(root, `${valid}.json`), { force: false });
}

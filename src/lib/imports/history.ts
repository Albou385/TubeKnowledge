import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { ImportHistoryEntry } from "@/lib/imports/types";

export function historyPath(rootPath: string): string {
  return path.join(rootPath, ".tubeknowledge", "import-history.jsonl");
}

export async function appendImportHistory(rootPath: string, entry: ImportHistoryEntry): Promise<void> {
  const target = historyPath(rootPath);
  await mkdir(path.dirname(target), { recursive: true });
  const serialized = JSON.stringify(entry);
  if (serialized.includes(rootPath)) throw new Error("L’historique contient un chemin absolu.");
  await appendFile(target, `${serialized}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function readImportHistory(rootPath: string): Promise<ImportHistoryEntry[]> {
  try {
    return (await readFile(historyPath(rootPath), "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as ImportHistoryEntry).reverse();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

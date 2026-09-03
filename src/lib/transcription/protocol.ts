import { workerEventSchema, type WorkerEvent } from "./schemas";

export const MAX_JSONL_LINE_BYTES = 1_048_576;
export const MAX_CAPTURED_LOG_BYTES = 65_536;

export function parseWorkerLine(line: string): WorkerEvent {
  if (Buffer.byteLength(line, "utf8") > MAX_JSONL_LINE_BYTES) throw new Error("Ligne JSONL du worker trop longue.");
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new Error("JSONL invalide reçu du worker.");
  }
  return workerEventSchema.parse(value);
}

export function appendBoundedLog(current: string, chunk: string): string {
  const combined = current + chunk;
  if (Buffer.byteLength(combined, "utf8") <= MAX_CAPTURED_LOG_BYTES) return combined;
  const bytes = Buffer.from(combined, "utf8");
  return `[journal tronqué]\n${bytes.subarray(bytes.length - MAX_CAPTURED_LOG_BYTES).toString("utf8")}`;
}


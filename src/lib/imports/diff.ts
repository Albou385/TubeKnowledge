import { diffLines } from "diff";

import { IMPORT_LIMITS } from "@/lib/imports/constants";

export interface DiffLine { type: "context" | "add" | "remove"; value: string; }
export interface TextDiff { lines: DiffLine[]; truncated: boolean; }

function normalizeLines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function createTextDiff(before: string, after: string, maxLines: number = IMPORT_LIMITS.maxDiffLines): TextDiff {
  const lines: DiffLine[] = [];
  for (const part of diffLines(normalizeLines(before), normalizeLines(after))) {
    const type: DiffLine["type"] = part.added ? "add" : part.removed ? "remove" : "context";
    const partLines = part.value.split("\n");
    if (partLines.at(-1) === "") partLines.pop();
    for (const value of partLines) lines.push({ type, value });
  }
  return { lines: lines.slice(0, maxLines), truncated: lines.length > maxLines };
}

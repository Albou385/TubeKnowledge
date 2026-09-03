import { describe, expect, it } from "vitest";
import { createTextDiff } from "@/lib/imports/diff";

describe("diff texte", () => {
  it("affiche créations et remplacements", () => { const diff = createTextDiff("ancien\n", "nouveau\n"); expect(diff.lines.map((line) => line.type)).toEqual(["remove", "add"]); });
  it("gère les fichiers vides", () => expect(createTextDiff("", "ligne\n").lines).toEqual([{ type: "add", value: "ligne" }]));
  it("normalise CRLF et LF", () => expect(createTextDiff("a\r\nb\r\n", "a\nb\n").lines.every((line) => line.type === "context")).toBe(true));
  it("tronque explicitement", () => { const diff = createTextDiff("", "a\nb\nc\n", 2); expect(diff.lines).toHaveLength(2); expect(diff.truncated).toBe(true); });
});

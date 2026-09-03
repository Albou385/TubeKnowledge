import { describe, expect, it } from "vitest";

import { CHATGPT_PACKAGE_LIMITS } from "./constants";
import { segmentTranscript } from "./segmentation";

describe("segmentation de transcription", () => {
  it("conserve une transcription courte sans dossier de parties", () => {
    const result = segmentTranscript("Un transcript court.");
    expect(result.segmented).toBe(false);
    expect(result.parts).toHaveLength(1);
    expect(result.index).toBeUndefined();
  });
  it("préfère paragraphes, conserve ordre, chevauchement, index et hashes sans couper de mot", () => {
    const paragraphs = Array.from({ length: 2_400 }, (_, index) => `Paragraphe ${index} sur les transformers et l’attention.\n\n`).join("");
    const result = segmentTranscript(paragraphs);
    expect(result.segmented).toBe(true);
    expect(result.parts.length).toBeGreaterThan(1);
    expect(result.parts[1].overlapCharacters).toBe(CHATGPT_PACKAGE_LIMITS.overlapCharacters);
    expect(result.parts.every((part) => /^[a-f0-9]{64}$/.test(part.sha256))).toBe(true);
    expect(result.index).toContain("part-001.md");
    expect(result.parts[0].content).toContain("Paragraphe 0");
    expect(result.parts.at(-1)?.content).toContain("Paragraphe 2399");
    expect(result.parts[0].content.trimEnd().endsWith("transformers et l’attention.")).toBe(true);
  });
  it("bloque au-delà de douze segments", () => {
    const huge = "mot ".repeat((CHATGPT_PACKAGE_LIMITS.targetSegmentCharacters * (CHATGPT_PACKAGE_LIMITS.maxSegments + 1)) / 4);
    expect(() => segmentTranscript(huge)).toThrow(/12 segments/);
  });
  it("préfère une frontière de segment temporel valide", () => {
    const first = "mot ".repeat(12_500); const second = "suite ".repeat(8_000); const transcript = `${first}${second}`;
    const result = segmentTranscript(transcript, [{ start: 0, end: 20, text: first.trim() }, { start: 20, end: 40, text: second.trim() }]);
    expect(result.segmented).toBe(true);
    expect(result.parts[1].startCharacter).toBe(first.trim().length - CHATGPT_PACKAGE_LIMITS.overlapCharacters);
  });
});

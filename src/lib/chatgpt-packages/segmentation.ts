import { sha256 } from "@/lib/imports/hash";

import { CHATGPT_PACKAGE_LIMITS } from "./constants";

export interface TimedSegment { start: number; end: number; text: string }
export interface TranscriptPart { name: string; content: string; sha256: string; startCharacter: number; overlapCharacters: number }
export interface SegmentationResult { segmented: boolean; parts: TranscriptPart[]; index?: string }

function safeBoundary(text: string, desired: number, minimum: number, temporalBoundaries: number[]): number {
  const temporal = temporalBoundaries.findLast((boundary) => boundary <= desired && boundary >= minimum);
  if (temporal !== undefined) return temporal;
  const paragraph = text.lastIndexOf("\n\n", desired);
  if (paragraph >= minimum) return paragraph + 2;
  const line = text.lastIndexOf("\n", desired);
  if (line >= minimum) return line + 1;
  const space = text.lastIndexOf(" ", desired);
  return space >= minimum ? space + 1 : desired;
}

function locateTemporalBoundaries(transcript: string, segments: TimedSegment[]): number[] {
  const boundaries: number[] = [];
  let cursor = 0;
  for (const segment of segments) {
    const text = segment.text.trim();
    const start = transcript.indexOf(text, cursor);
    if (start < 0) continue;
    const end = start + text.length;
    if (segment.end >= segment.start) boundaries.push(end);
    cursor = end;
  }
  return boundaries;
}

export function segmentTranscript(transcript: string, timedSegments: TimedSegment[] = []): SegmentationResult {
  if (transcript.length <= CHATGPT_PACKAGE_LIMITS.simpleTranscriptCharacters) {
    const content = transcript.endsWith("\n") ? transcript : `${transcript}\n`;
    return { segmented: false, parts: [{ name: "part-001.md", content, sha256: sha256(content), startCharacter: 0, overlapCharacters: 0 }] };
  }
  const parts: TranscriptPart[] = [];
  const temporalBoundaries = locateTemporalBoundaries(transcript, timedSegments);
  let start = 0;
  while (start < transcript.length) {
    if (parts.length >= CHATGPT_PACKAGE_LIMITS.maxSegments) {
      throw new Error(`La transcription dépasse le maximum de ${CHATGPT_PACKAGE_LIMITS.maxSegments} segments. Utilisez une acquisition plus ciblée.`);
    }
    const desiredEnd = Math.min(transcript.length, start + CHATGPT_PACKAGE_LIMITS.targetSegmentCharacters);
    const end = desiredEnd === transcript.length ? desiredEnd : safeBoundary(transcript, desiredEnd, start + Math.floor(CHATGPT_PACKAGE_LIMITS.targetSegmentCharacters * 0.75), temporalBoundaries);
    const overlap = parts.length === 0 ? 0 : Math.min(CHATGPT_PACKAGE_LIMITS.overlapCharacters, start);
    const contentStart = start - overlap;
    const body = transcript.slice(contentStart, end).trimEnd();
    const header = `# Partie ${String(parts.length + 1).padStart(3, "0")}\n\n> Position : caractères ${contentStart} à ${end}. Chevauchement initial : ${overlap} caractères.\n\n`;
    const content = `${header}${body}\n`;
    parts.push({ name: `part-${String(parts.length + 1).padStart(3, "0")}.md`, content, sha256: sha256(content), startCharacter: contentStart, overlapCharacters: overlap });
    start = end;
  }
  const index = `# Index de la transcription segmentée\n\n${parts.map((part, index) => `- [${part.name}](./${part.name}) — partie ${index + 1}, SHA-256 \`${part.sha256}\`, chevauchement ${part.overlapCharacters}`).join("\n")}\n`;
  return { segmented: true, parts, index };
}

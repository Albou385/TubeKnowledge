import { describe, expect, it } from "vitest";

import type { ImportSession } from "@/lib/imports/types";

import { automaticTranscriptionSource, isSafeSimpleModeSession, selectOriginalSubtitleTrack } from "./automation";

function session(operations: ImportSession["operations"], level: "none" | "minor" = "none"): Pick<ImportSession, "manifest" | "operations"> {
  return {
    manifest: { structuralChange: { level, confirmationRequired: level !== "none", summary: "Fixture" } } as ImportSession["manifest"],
    operations,
  };
}

describe("auto-application du mode simple", () => {
  it("n’autorise que la création d’une notion à trois niveaux", () => {
    expect(isSafeSimpleModeSession(session([{ type: "create", path: "01_BIBLIOTHEQUE/IA/Agents/notion.md", content: "# Notion\n", newSha256: "a".repeat(64), beforeContent: null, beforeSha256: null, beforeSize: null, beforeMtimeMs: null }]))).toBe(true);
    expect(isSafeSimpleModeSession(session([{ type: "create", path: "01_BIBLIOTHEQUE/IA/notion.md", content: "# Notion\n", newSha256: "a".repeat(64), beforeContent: null, beforeSha256: null, beforeSize: null, beforeMtimeMs: null }]))).toBe(false);
  });

  it("refuse tout changement structurel ou remplacement non append-only", () => {
    expect(isSafeSimpleModeSession(session([{ type: "replace", path: "01_BIBLIOTHEQUE/IA/Agents/notion.md", content: "# Réécrit\n", newSha256: "a".repeat(64), beforeContent: "# Avant\n", beforeSha256: "b".repeat(64), beforeSize: 8, beforeMtimeMs: 0 }]))).toBe(false);
    expect(isSafeSimpleModeSession(session([{ type: "create", path: "01_BIBLIOTHEQUE/IA/Agents/notion.md", content: "# Notion\n", newSha256: "a".repeat(64), beforeContent: null, beforeSha256: null, beforeSize: null, beforeMtimeMs: null }], "minor"))).toBe(false);
  });

  it("n’automatise jamais une piste traduite lorsque la langue originale est connue", () => {
    const tracks = [
      { language: "en", origin: "manual" as const, formats: [{ extension: "vtt" as const }] },
      { language: "fr", origin: "automatic" as const, formats: [{ extension: "vtt" as const }] },
    ];
    expect(selectOriginalSubtitleTrack(tracks, "fr-CA")).toMatchObject({ language: "fr", origin: "automatic" });
    expect(selectOriginalSubtitleTrack([tracks[0]], "fr")).toBeUndefined();
  });

  it("bascule vers Whisper sans langue imposée si la langue est inconnue ou sans sous-titres", () => {
    const tracks = [{ language: "en", origin: "automatic" as const, formats: [{ extension: "vtt" as const }] }];
    expect(automaticTranscriptionSource(tracks, undefined)).toEqual({ kind: "whisper", profile: "fast", confirmModelDownload: true, confirmLongVideo: true });
    expect(automaticTranscriptionSource([], "fr")).toEqual({ kind: "whisper", profile: "fast", confirmModelDownload: true, confirmLongVideo: true });
  });
});

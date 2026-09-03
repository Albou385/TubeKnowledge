import { describe, expect, it } from "vitest";

import type { SubtitleTrack } from "./types";
import { recommendedSubtitleTrack, sameSubtitleTrack, visibleWorkflowSubtitleTracks } from "./subtitle-tracks";

const manualSpecialized: SubtitleTrack = { language: "en-j3PyPqV-e1s", origin: "manual", formats: [{ extension: "vtt" }] };
const automaticEnglish: SubtitleTrack = { language: "en", origin: "automatic", formats: [{ extension: "vtt" }] };
const automaticFrench: SubtitleTrack = { language: "fr", origin: "automatic", formats: [{ extension: "srt" }] };

describe("pistes de sous-titres du workflow", () => {
  it("conserve visible et sélectionnable la recommandation manuelle yt-dlp hors des langues compactes", () => {
    const tracks = [automaticEnglish, manualSpecialized, automaticFrench];
    const recommendation = recommendedSubtitleTrack(tracks);
    const visible = visibleWorkflowSubtitleTracks(tracks, false);

    expect(recommendation).toEqual(manualSpecialized);
    expect(visible[0]).toEqual(manualSpecialized);
    expect(visible.some((track) => sameSubtitleTrack(track, recommendation))).toBe(true);
  });

  it("garde toutes les pistes quand l’utilisateur demande les autres langues", () => {
    expect(visibleWorkflowSubtitleTracks([automaticEnglish, manualSpecialized, automaticFrench], true)).toHaveLength(3);
  });
});

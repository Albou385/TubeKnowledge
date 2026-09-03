import type { SubtitleTrack } from "./types";

export const WORKFLOW_PREFERRED_SUBTITLE_LANGUAGES = ["fr-CA", "fr", "en-CA", "en"];

export function rankSubtitleTrack(track: SubtitleTrack): number {
  const language = WORKFLOW_PREFERRED_SUBTITLE_LANGUAGES.indexOf(track.language);
  return (track.origin === "manual" ? 0 : 100) + (language < 0 ? 50 : language);
}

export function sameSubtitleTrack(left: SubtitleTrack | undefined, right: SubtitleTrack | undefined): boolean {
  return left?.origin === right?.origin && left?.language === right?.language;
}

export function recommendedSubtitleTrack(tracks: SubtitleTrack[]): SubtitleTrack | undefined {
  return [...tracks].sort((left, right) => rankSubtitleTrack(left) - rankSubtitleTrack(right) || left.language.localeCompare(right.language))[0];
}

/**
 * La liste compacte garde la préférence manuelle, y compris lorsqu'un identifiant
 * de piste spécifique à yt-dlp n'est pas dans les langues courantes de l'interface.
 */
export function visibleWorkflowSubtitleTracks(tracks: SubtitleTrack[], allLanguages: boolean): SubtitleTrack[] {
  const sorted = [...tracks].sort((left, right) => rankSubtitleTrack(left) - rankSubtitleTrack(right) || left.language.localeCompare(right.language));
  if (allLanguages) return sorted;

  const visible = sorted.filter((track) => WORKFLOW_PREFERRED_SUBTITLE_LANGUAGES.includes(track.language)).slice(0, 6);
  const recommendation = recommendedSubtitleTrack(sorted);
  if (recommendation && !visible.some((track) => sameSubtitleTrack(track, recommendation))) visible.unshift(recommendation);
  return visible;
}

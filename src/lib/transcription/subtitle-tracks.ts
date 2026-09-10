import type { SubtitleTrack } from "./types";

export const WORKFLOW_PREFERRED_SUBTITLE_LANGUAGES = ["fr-CA", "fr", "en-CA", "en"];

function languageFamily(language: string): string {
  return language.toLocaleLowerCase("en").split(/[-_]/u, 1)[0] ?? language;
}

export function rankSubtitleTrack(track: SubtitleTrack, originalLanguage?: string): number {
  const language = WORKFLOW_PREFERRED_SUBTITLE_LANGUAGES.indexOf(track.language);
  const originalFamily = originalLanguage ? languageFamily(originalLanguage) : undefined;
  const sameOriginalLanguage = originalFamily && languageFamily(track.language) === originalFamily;
  return (track.origin === "manual" ? 0 : 100) + (sameOriginalLanguage ? 0 : 1_000) + (language < 0 ? 50 : language);
}

export function sameSubtitleTrack(left: SubtitleTrack | undefined, right: SubtitleTrack | undefined): boolean {
  return left?.origin === right?.origin && left?.language === right?.language;
}

export function recommendedSubtitleTrack(tracks: SubtitleTrack[], originalLanguage?: string): SubtitleTrack | undefined {
  return [...tracks].sort((left, right) => rankSubtitleTrack(left, originalLanguage) - rankSubtitleTrack(right, originalLanguage) || left.language.localeCompare(right.language))[0];
}

/**
 * La liste compacte garde la préférence manuelle, y compris lorsqu'un identifiant
 * de piste spécifique à yt-dlp n'est pas dans les langues courantes de l'interface.
 */
export function visibleWorkflowSubtitleTracks(tracks: SubtitleTrack[], allLanguages: boolean, originalLanguage?: string): SubtitleTrack[] {
  const sorted = [...tracks].sort((left, right) => rankSubtitleTrack(left, originalLanguage) - rankSubtitleTrack(right, originalLanguage) || left.language.localeCompare(right.language));
  if (allLanguages) return sorted;

  const visible = sorted.filter((track) => WORKFLOW_PREFERRED_SUBTITLE_LANGUAGES.includes(track.language)).slice(0, 6);
  const recommendation = recommendedSubtitleTrack(sorted, originalLanguage);
  if (recommendation && !visible.some((track) => sameSubtitleTrack(track, recommendation))) visible.unshift(recommendation);
  return visible;
}

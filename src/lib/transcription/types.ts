export const JOB_STATUSES = [
  "queued",
  "inspecting",
  "waiting-for-selection",
  "downloading-subtitles",
  "normalizing-subtitles",
  "downloading-audio",
  "probing-audio",
  "converting-audio",
  "loading-model",
  "transcribing",
  "normalizing-transcript",
  "completed",
  "failed",
  "canceling",
  "canceled",
  "interrupted",
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];
export type SourceKind = "manual-subtitles" | "automatic-subtitles" | "local-whisper" | "uploaded-transcript";

export interface SubtitleTrack {
  language: string;
  name?: string;
  origin: "manual" | "automatic";
  formats: Array<{ extension: "vtt" | "srt"; url?: string }>;
}

export interface VideoInspection {
  videoId: string;
  title: string;
  durationSeconds: number;
  canonicalUrl: string;
  language?: string;
  chapters: Array<{ title: string; start: number; end?: number }>;
  subtitles: SubtitleTrack[];
  liveStatus: "not-live" | "was-live" | "is-live" | "upcoming";
  estimatedAudioBytes?: number;
  warnings: Array<{ code: string; message: string }>;
}

export interface JobWarning {
  code: string;
  message: string;
}

export interface JobArtifact {
  kind: string;
  name: string;
}

export interface AcquisitionJob {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  stage: string;
  progress: number | null;
  message: string;
  title?: string;
  sourceKind?: SourceKind;
  source?: { type: "youtube" | "upload"; canonicalUrl?: string; videoId?: string; originalName?: string };
  inspection?: VideoInspection;
  warnings: JobWarning[];
  artifacts: JobArtifact[];
  error?: { code: string; message: string };
  options?: {
    language?: string;
    subtitleOrigin?: "manual" | "automatic";
    subtitleFormat?: "vtt" | "srt";
    profile?: "fast" | "balanced" | "quality";
    model?: string;
    device?: "cpu" | "cuda";
    computeType?: string;
    keepAudio?: boolean;
    startTime?: number;
    endTime?: number;
  };
}

export const TERMINAL_STATUSES = new Set<JobStatus>(["completed", "failed", "canceled", "interrupted"]);


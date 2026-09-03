import path from "node:path";

import { z } from "zod";

import { getRuntimeLocation } from "./runtime-location";

export { isInsidePath } from "./paths";

const positiveInteger = (fallback: number, maximum: number) => z.coerce.number().int().min(1).max(maximum).catch(fallback);

const envSchema = z.object({
  TUBEKNOWLEDGE_RUNTIME_PATH: z.string().optional(),
  TUBEKNOWLEDGE_PYTHON_PATH: z.string().optional(),
  TUBEKNOWLEDGE_FFMPEG_PATH: z.string().optional(),
  TUBEKNOWLEDGE_FFPROBE_PATH: z.string().optional(),
  TUBEKNOWLEDGE_TRANSCRIPTION_CONCURRENCY: positiveInteger(1, 2),
  TUBEKNOWLEDGE_DEFAULT_WHISPER_MODEL: z.string().min(1).max(100).catch("small"),
  TUBEKNOWLEDGE_DEFAULT_WHISPER_DEVICE: z.enum(["cpu", "cuda"]).catch("cpu"),
  TUBEKNOWLEDGE_DEFAULT_COMPUTE_TYPE: z.string().min(2).max(30).catch("int8"),
  TUBEKNOWLEDGE_MAX_VIDEO_MINUTES: positiveInteger(360, 1_440),
  YOUTUBE_LIBRARY_PATH: z.string().optional(),
}).passthrough();

export interface TranscriptionConfig {
  runtimePath: string;
  acquisitionsPath: string;
  modelCachePath: string;
  pythonPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  concurrency: number;
  defaultModel: string;
  defaultDevice: "cpu" | "cuda";
  defaultComputeType: string;
  maxVideoMinutes: number;
}

export function getTranscriptionConfig(environment: NodeJS.ProcessEnv = process.env): TranscriptionConfig {
  const env = envSchema.parse(environment);
  const location = getRuntimeLocation(environment);
  return {
    ...location,
    pythonPath: env.TUBEKNOWLEDGE_PYTHON_PATH || path.join(/* turbopackIgnore: true */ process.cwd(), ".venv-transcription", "Scripts", "python.exe"),
    ffmpegPath: env.TUBEKNOWLEDGE_FFMPEG_PATH || "ffmpeg",
    ffprobePath: env.TUBEKNOWLEDGE_FFPROBE_PATH || "ffprobe",
    concurrency: env.TUBEKNOWLEDGE_TRANSCRIPTION_CONCURRENCY,
    defaultModel: env.TUBEKNOWLEDGE_DEFAULT_WHISPER_MODEL,
    defaultDevice: env.TUBEKNOWLEDGE_DEFAULT_WHISPER_DEVICE,
    defaultComputeType: env.TUBEKNOWLEDGE_DEFAULT_COMPUTE_TYPE,
    maxVideoMinutes: env.TUBEKNOWLEDGE_MAX_VIDEO_MINUTES,
  };
}

export const WHISPER_PROFILES = {
  fast: { model: "small", device: "cpu" as const, computeType: "int8" },
  balanced: { model: "medium", device: "cpu" as const, computeType: "int8" },
  quality: { model: "large-v3", device: "cpu" as const, computeType: "int8" },
};

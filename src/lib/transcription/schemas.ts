import { z } from "zod";

import { JOB_STATUSES } from "./types";

const workerBase = z.object({ type: z.string() });

export const workerEventSchema = z.discriminatedUnion("type", [
  workerBase.extend({ type: z.literal("started"), stage: z.string().min(1).max(80) }).strict(),
  workerBase.extend({
    type: z.literal("progress"),
    stage: z.string().min(1).max(80),
    progress: z.number().min(0).max(1).nullable().optional(),
    message: z.string().max(1_000),
  }).strict(),
  workerBase.extend({
    type: z.literal("artifact"),
    kind: z.string().min(1).max(80),
    relativePath: z.string().min(1).max(260),
  }).strict(),
  workerBase.extend({
    type: z.literal("warning"),
    code: z.string().regex(/^[A-Z0-9_]+$/).max(80),
    message: z.string().max(1_000),
  }).strict(),
  workerBase.extend({ type: z.literal("completed"), result: z.record(z.string(), z.unknown()) }).strict(),
  workerBase.extend({
    type: z.literal("failed"),
    code: z.string().regex(/^[A-Z0-9_]+$/).max(80),
    message: z.string().max(1_000),
  }).strict(),
]);

export type WorkerEvent = z.infer<typeof workerEventSchema>;

const subtitleFormatSchema = z.object({
  extension: z.enum(["vtt", "srt"]),
  url: z.string().url().optional(),
}).strict();

const languageCodeSchema = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/).max(20);
// yt-dlp exposes some manually authored subtitle tracks with several bounded
// alphanumeric segments (for example en-j3PyPqV-e1s). This remains a track
// identifier, never a URL or a command-line option.
const subtitleTrackLanguageSchema = z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,12}){0,4}$/).max(40);

export const videoInspectionSchema = z.object({
  videoId: z.string().min(6).max(20),
  title: z.string().min(1).max(500),
  durationSeconds: z.number().nonnegative().finite(),
  canonicalUrl: z.string().url(),
  language: z.string().max(40).optional(),
  chapters: z.array(z.object({ title: z.string().max(500), start: z.number().nonnegative(), end: z.number().nonnegative().optional() }).strict()).max(500),
  subtitles: z.array(z.object({
    language: z.string().min(1).max(40),
    name: z.string().max(200).optional(),
    origin: z.enum(["manual", "automatic"]),
    formats: z.array(subtitleFormatSchema).min(1).max(10),
  }).strict()).max(500),
  liveStatus: z.enum(["not-live", "was-live", "is-live", "upcoming"]),
  estimatedAudioBytes: z.number().int().nonnegative().optional(),
  warnings: z.array(z.object({ code: z.string().max(80), message: z.string().max(1_000) }).strict()).max(50).default([]),
}).strict();

export const jobStatusSchema = z.enum(JOB_STATUSES);

export const inspectRequestSchema = z.object({ url: z.string().min(1).max(2_048) }).strict();

export const startAcquisitionSchema = z.object({
  jobId: z.string().uuid(),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("subtitles"), language: subtitleTrackLanguageSchema, origin: z.enum(["manual", "automatic"]), format: z.enum(["vtt", "srt"]) }).strict(),
    z.object({
      kind: z.literal("whisper"),
      profile: z.enum(["fast", "balanced", "quality"]).default("fast"),
      language: languageCodeSchema.optional(),
      device: z.enum(["cpu", "cuda"]).default("cpu"),
      computeType: z.string().regex(/^[a-z0-9_-]{2,30}$/).default("int8"),
      confirmQuality: z.boolean().default(false),
      confirmLongVideo: z.boolean().default(false),
      confirmModelDownload: z.boolean().default(false),
      keepAudio: z.boolean().default(false),
      startTime: z.number().nonnegative().optional(),
      endTime: z.number().positive().optional(),
    }).strict(),
  ]),
}).strict();

export const uploadMetadataSchema = z.object({
  title: z.string().trim().min(1).max(500),
  url: z.union([z.literal(""), z.string().url().max(2_048)]).optional(),
}).strict();

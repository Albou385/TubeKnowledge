import { z } from "zod";

export const VIDEO_QUEUE_STATES = [
  "queued",
  "inspecting",
  "transcribing",
  "transcript-ready",
  "analysis-required",
  "result-ready",
  "imported",
  "paused",
  "cancelled",
  "failed",
] as const;

export const videoQueueItemStateSchema = z.enum(VIDEO_QUEUE_STATES);
export type VideoQueueItemState = z.infer<typeof videoQueueItemStateSchema>;

export const queuePauseReasonSchema = z.enum(["global", "source-selection-required"]);

export const videoQueueItemSchema = z.object({
  itemId: z.string().uuid(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  canonicalUrl: z.url().refine((value) => new URL(value).protocol === "https:", "URL HTTPS requise."),
  videoId: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/),
  state: videoQueueItemStateSchema,
  workflowId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(500).optional(),
  pauseReason: queuePauseReasonSchema.optional(),
  resumeState: videoQueueItemStateSchema.optional(),
  lastErrorCode: z.string().regex(/^[A-Z0-9_]+$/).max(80).optional(),
  attemptCount: z.number().int().min(0).max(100),
}).strict();

export type VideoQueueItem = z.infer<typeof videoQueueItemSchema>;

export const queueHistoryEntrySchema = z.object({
  eventId: z.string().uuid(),
  itemId: z.string().uuid(),
  at: z.iso.datetime(),
  from: videoQueueItemStateSchema.optional(),
  to: videoQueueItemStateSchema,
  reasonCode: z.string().regex(/^[A-Z0-9_]+$/).max(80),
}).strict();

export const queueCommandRecordSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  command: z.enum(["add", "pause", "resume", "cancel", "retry", "reconcile"]),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  completedAt: z.iso.datetime(),
  result: z.json(),
}).strict();

export const videoQueueStoreSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  paused: z.boolean(),
  activeItemId: z.string().uuid().nullable(),
  items: z.array(videoQueueItemSchema).max(10_000),
  history: z.array(queueHistoryEntrySchema).max(500),
  commands: z.array(queueCommandRecordSchema).max(200),
}).strict();

export type VideoQueueStore = z.infer<typeof videoQueueStoreSchema>;

export const addVideosCommandSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  urls: z.array(z.string().trim().min(1).max(2_048)).min(1).max(100),
}).strict();

export const idempotentCommandSchema = z.object({
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
}).strict();


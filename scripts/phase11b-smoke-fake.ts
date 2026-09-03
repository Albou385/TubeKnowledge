import assert from "node:assert/strict";

import type { AddVideoResult, VideoQueueSnapshot } from "../src/lib/video-queue/engine";
import type { VideoQueueItem } from "../src/lib/video-queue/schema";
import { VIDEO_QUEUE_STATE_LABELS, groupAddResults, parseQueueInput, shouldPollVideoQueue } from "../src/lib/video-queue/ui";

const parsed = parseQueueInput("  https://youtu.be/abcDEF_1234  \n\nhttps://youtube.com/shorts/xyzABC_9876\n");
assert.deepEqual(parsed.urls, ["https://youtu.be/abcDEF_1234", "https://youtube.com/shorts/xyzABC_9876"]);
assert.equal(parsed.validationMessage, null);

const results: AddVideoResult[] = [
  { inputIndex: 0, status: "accepted", videoId: "accepted01" },
  { inputIndex: 1, status: "duplicate", duplicates: [{ kind: "submission", imported: false }] },
  { inputIndex: 2, status: "duplicate", duplicates: [{ kind: "queue", imported: false }] },
  { inputIndex: 3, status: "duplicate", duplicates: [{ kind: "workflow", imported: false }] },
  { inputIndex: 4, status: "duplicate", duplicates: [{ kind: "library", imported: true }] },
  { inputIndex: 5, status: "rejected", errorCode: "INVALID_YOUTUBE_URL" },
];
assert.deepEqual(Object.values(groupAddResults(results)).map((entries) => entries.length), [1, 1, 1, 1, 1, 1]);
assert.equal(Object.keys(VIDEO_QUEUE_STATE_LABELS).length, 10);

const queued: VideoQueueItem = {
  itemId: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-07-28T12:00:00.000Z",
  updatedAt: "2026-07-28T12:00:00.000Z",
  canonicalUrl: "https://www.youtube.com/watch?v=abcDEF_1234",
  videoId: "abcDEF_1234",
  state: "queued",
  attemptCount: 0,
};
const snapshot: VideoQueueSnapshot = { revision: 1, paused: false, activeItemId: null, items: [queued], history: [] };
assert.equal(shouldPollVideoQueue(snapshot), true);
assert.equal(shouldPollVideoQueue({ ...snapshot, paused: true }), false);

process.stdout.write("[OK] Phase 11B UI smoke factice: saisie, six catégories, dix états et polling borné.\n");

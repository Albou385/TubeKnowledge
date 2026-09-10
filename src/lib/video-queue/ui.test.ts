import { describe, expect, it } from "vitest";

import type { AddVideoResult, VideoQueueSnapshot } from "./engine";
import type { VideoQueueItem, VideoQueueItemState } from "./schema";
import {
  ADD_RESULT_TITLES,
  VIDEO_QUEUE_STATE_LABELS,
  groupAddResults,
  parseQueueInput,
  publicQueueItemError,
  queueNextAction,
  safeVideoLabel,
  shouldPollVideoQueue,
  workflowActionLabel,
} from "./ui";

const states: VideoQueueItemState[] = ["queued", "inspecting", "transcribing", "transcript-ready", "analysis-required", "result-ready", "imported", "paused", "cancelled", "failed"];

function item(state: VideoQueueItemState, changes: Partial<VideoQueueItem> = {}): VideoQueueItem {
  return { itemId: "11111111-1111-4111-8111-111111111111", createdAt: "2026-07-28T12:00:00.000Z", updatedAt: "2026-07-28T12:00:00.000Z", canonicalUrl: "https://www.youtube.com/watch?v=abcDEF_1234", videoId: "abcDEF_1234", state, attemptCount: 0, ...changes };
}

function snapshot(items: VideoQueueItem[], paused = false): VideoQueueSnapshot {
  return { revision: 1, paused, activeItemId: items.find((entry) => ["inspecting", "transcribing"].includes(entry.state))?.itemId ?? null, items, history: [] };
}

describe("présentation de la file vidéo", () => {
  it("tolère espaces et lignes vides dans une saisie multiligne", () => {
    expect(parseQueueInput("  https://youtu.be/abcDEF_1234  \n\n https://youtube.com/shorts/xyzABC_9876 \n")).toEqual({ urls: ["https://youtu.be/abcDEF_1234", "https://youtube.com/shorts/xyzABC_9876"], lineCount: 2, validationMessage: null });
  });

  it("valide file vide, limite de lignes et longueur maximale", () => {
    expect(parseQueueInput(" \n ").validationMessage).toContain("au moins une");
    expect(parseQueueInput(Array.from({ length: 101 }, () => "https://youtu.be/abcDEF_1234").join("\n")).validationMessage).toContain("100");
    expect(parseQueueInput(`https://youtu.be/${"a".repeat(2_100)}`).validationMessage).toContain("longueur");
  });

  it("présente exactement les dix états humains attendus", () => {
    expect(Object.keys(VIDEO_QUEUE_STATE_LABELS)).toEqual(states);
    expect(Object.values(VIDEO_QUEUE_STATE_LABELS)).toEqual(["En attente", "Inspection", "Transcription", "Analyse", "Analyse", "Vérification nécessaire", "Terminé", "En pause", "Annulée", "Échec"]);
  });

  it.each(states)("fournit une prochaine action humaine pour %s", (state) => {
    expect(queueNextAction(item(state, state === "paused" ? { pauseReason: "global", resumeState: "queued" } : {}))).toMatch(/[.!]$/);
  });

  it("distingue la pause globale de la décision de transcription", () => {
    expect(queueNextAction(item("paused", { pauseReason: "source-selection-required", resumeState: "transcribing" }))).toContain("Vérification nécessaire");
    expect(workflowActionLabel(item("paused", { pauseReason: "source-selection-required", resumeState: "transcribing" }))).toBe("Vérifier");
  });

  it("regroupe les six résultats de soumission sans exposer d’identifiant", () => {
    const results: AddVideoResult[] = [
      { inputIndex: 0, status: "accepted", videoId: "accepted01" },
      { inputIndex: 1, status: "duplicate", duplicates: [{ kind: "submission", imported: false }] },
      { inputIndex: 2, status: "duplicate", duplicates: [{ kind: "queue", imported: false }] },
      { inputIndex: 3, status: "duplicate", duplicates: [{ kind: "workflow", imported: false }] },
      { inputIndex: 4, status: "duplicate", duplicates: [{ kind: "library", imported: true }] },
      { inputIndex: 5, status: "rejected", errorCode: "INVALID_YOUTUBE_URL" },
    ];
    expect(Object.fromEntries(Object.entries(groupAddResults(results)).map(([key, values]) => [key, values.length]))).toEqual({ accepted: 1, submission: 1, queue: 1, workflow: 1, library: 1, invalid: 1 });
    expect(Object.keys(ADD_RESULT_TITLES)).toHaveLength(6);
  });

  it("borne le polling aux états qui peuvent avancer", () => {
    expect(shouldPollVideoQueue(snapshot([]))).toBe(false);
    expect(shouldPollVideoQueue(snapshot([item("queued")]))).toBe(true);
    expect(shouldPollVideoQueue(snapshot([item("queued")], true))).toBe(false);
    expect(shouldPollVideoQueue(snapshot([item("transcribing")], true))).toBe(true);
    expect(shouldPollVideoQueue(snapshot([item("transcript-ready")]))).toBe(false);
  });

  it("rend un identifiant vidéo sûr et ferme les erreurs inconnues", () => {
    expect(safeVideoLabel("abcDEF_1234")).toBe("youtube.com · abcDEF_1234");
    expect(publicQueueItemError("C:\\private\\secret")).not.toContain("private");
    expect(publicQueueItemError("YOUTUBE_RATE_LIMITED")).toContain("Attendez");
  });
});


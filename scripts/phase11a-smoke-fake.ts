import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { VideoQueueEngine, type QueueWorkflowAdapter } from "../src/lib/video-queue/engine";
import { nextActionForState, type VideoKnowledgeWorkflow } from "../src/lib/workflows/schema";

function record(workflowId: string, sourceUrl: string, state: "draft" | "source-selection" | "canceled"): VideoKnowledgeWorkflow {
  const now = "2026-07-28T12:00:00.000Z";
  return { schemaVersion: 1, workflowId, createdAt: now, updatedAt: now, state, sourceUrl, nextAction: nextActionForState(state), reprocessingApproved: false, knowledgePaths: [] };
}

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-phase11a-smoke-"));
  const workflows = new Map<string, VideoKnowledgeWorkflow>();
  let active = 0; let maximum = 0;
  const adapter: QueueWorkflowAdapter = {
    detectDuplicates: async () => [],
    create: async (sourceUrl, workflowId) => { const value = record(workflowId, sourceUrl, "draft"); workflows.set(workflowId, value); return value; },
    inspect: async (workflowId) => {
      active++; maximum = Math.max(maximum, active);
      const current = workflows.get(workflowId); if (!current) throw new Error("Workflow fixture absent.");
      const value = record(workflowId, current.sourceUrl, "source-selection"); workflows.set(workflowId, value); active--; return value;
    },
    load: async (workflowId) => { const value = workflows.get(workflowId); if (!value) throw new Error("Workflow fixture absent."); return value; },
    synchronize: async (workflowId) => { const value = workflows.get(workflowId); if (!value) throw new Error("Workflow fixture absent."); return value; },
    retry: async (workflowId) => { const value = workflows.get(workflowId); if (!value) throw new Error("Workflow fixture absent."); return value; },
    cancel: async (workflowId) => { const current = workflows.get(workflowId); if (!current) throw new Error("Workflow fixture absent."); const value = record(workflowId, current.sourceUrl, "canceled"); workflows.set(workflowId, value); return value; },
  };
  try {
    const engine = new VideoQueueEngine({ root, adapter, autoProcess: false });
    const added = await engine.add({ idempotencyKey: "phase11a:smoke:add", urls: ["https://youtu.be/abcDEF_1234?si=tracking", "https://youtube.com/shorts/xyzABC_9876"] });
    if (added.results.some((item) => item.status !== "accepted")) throw new Error("Ajout multiple fixture invalide.");
    await engine.pause({ idempotencyKey: "phase11a:smoke:pause" });
    await engine.resume({ idempotencyKey: "phase11a:smoke:resume" });
    await engine.start();
    const queue = await engine.snapshot();
    if (maximum !== 1 || queue.items.some((item) => item.state !== "paused" || item.pauseReason !== "source-selection-required")) throw new Error("Séquencement fixture invalide.");
    process.stdout.write("[OK] file Phase 11A persistante, concurrence 1, pause/reprise et arrêt au choix humain\n");
    process.stdout.write("[OK] runtime, workflows et worker entièrement factices sous %TEMP%\n");
  } finally { await rm(root, { recursive: true, force: true }); }
}

main().catch((error) => { process.stderr.write(error instanceof Error ? error.message : "Smoke Phase 11A échoué."); process.exitCode = 1; });

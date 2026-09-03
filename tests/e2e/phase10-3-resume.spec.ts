import { expect, test } from "@playwright/test";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const qaRoot = path.join(os.tmpdir(), "tubeknowledge-phase10-3-playwright");
const runtime = path.join(qaRoot, "runtime");
const acquisitions = path.join(runtime, "acquisitions");
const workflows = path.join(runtime, "video-knowledge-workflows");
const reportRoot = path.resolve("reports", "phase-10-3-qa", "playwright");
const id = "a0000000-0000-4000-8000-000000000001";

test.beforeAll(async () => {
  const jobRoot = path.join(acquisitions, id);
  await Promise.all(["raw", "work", "output", "logs"].map((directory) => mkdir(path.join(jobRoot, directory), { recursive: true })));
  const now = "2026-07-27T19:00:00.000Z";
  await writeFile(path.join(jobRoot, "job.json"), `${JSON.stringify({
    schemaVersion: 1, id, createdAt: now, updatedAt: now, status: "failed", stage: "failed", progress: null,
    message: "YouTube limite temporairement les requêtes.", title: "Reprise fixture", sourceKind: "automatic-subtitles",
    source: { type: "youtube", canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk", videoId: "abcdefghijk" },
    inspection: { videoId: "abcdefghijk", title: "Reprise fixture", durationSeconds: 60, canonicalUrl: "https://www.youtube.com/watch?v=abcdefghijk", chapters: [], subtitles: [{ language: "fr", origin: "automatic", formats: [{ extension: "vtt" }] }], liveStatus: "not-live", warnings: [] },
    warnings: [], artifacts: [], error: { code: "YOUTUBE_RATE_LIMITED", message: "Message fixture" }, options: { language: "fr", subtitleOrigin: "automatic", subtitleFormat: "vtt" },
  }, null, 2)}\n`, "utf8");
  await writeFile(path.join(workflows, `${id}.json`), `${JSON.stringify({
    schemaVersion: 1, workflowId: id, createdAt: now, updatedAt: now, state: "failed", sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    videoId: "abcdefghijk", title: "Reprise fixture", acquisitionId: id, lastErrorCode: "YOUTUBE_RATE_LIMITED", nextAction: "Examiner l’erreur et réessayer", reprocessingApproved: false, knowledgePaths: [],
  }, null, 2)}\n`, "utf8");
  await mkdir(reportRoot, { recursive: true });
});

test.afterAll(async () => { await rm(path.join(qaRoot, "runtime", "acquisitions", id), { recursive: true, force: true }); });

test("un double clic reprend une seule fois le même workflow et la même acquisition", async ({ page }) => {
  const beforeAcquisitions = (await readdir(acquisitions)).length;
  const beforeWorkflows = (await readdir(workflows)).length;
  let resumeRequests = 0;
  await page.route(`**/api/workflows/${id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    resumeRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ workflow: {
      schemaVersion: 1, workflowId: id, createdAt: "2026-07-27T19:00:00.000Z", updatedAt: "2026-07-27T19:01:00.000Z", state: "acquiring",
      sourceUrl: "https://www.youtube.com/watch?v=abcdefghijk", videoId: "abcdefghijk", title: "Reprise fixture", acquisitionId: id,
      nextAction: "Suivre la transcription", reprocessingApproved: false, knowledgePaths: [],
    } }) });
  });
  await page.goto(`/workflows/${id}`, { waitUntil: "networkidle" });
  const resume = page.getByRole("button", { name: "Reprendre" });
  await expect(resume).toBeVisible();
  await resume.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole("heading", { name: "Transcription en cours" })).toBeVisible();
  expect(resumeRequests).toBe(1);
  expect((await readdir(acquisitions)).length).toBe(beforeAcquisitions);
  expect((await readdir(workflows)).length).toBe(beforeWorkflows);
  await page.screenshot({ path: path.join(reportRoot, "reprise-idempotente-fixture.png"), fullPage: true });
});

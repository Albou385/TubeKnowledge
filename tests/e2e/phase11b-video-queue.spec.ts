import { expect, test, type Page, type Route } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AddVideoResult, VideoQueueSnapshot } from "../../src/lib/video-queue/engine";
import type { VideoQueueItem, VideoQueueItemState } from "../../src/lib/video-queue/schema";

const qaRoot = path.join(os.tmpdir(), "tubeknowledge-phase11b-playwright");
const vault = path.join(qaRoot, "vault");
const sessions = path.join(qaRoot, "import-sessions");
const states: VideoQueueItemState[] = ["queued", "inspecting", "transcribing", "transcript-ready", "analysis-required", "result-ready", "imported", "paused", "cancelled", "failed"];
const stateTitles = ["En attente", "Inspection", "Transcription", "Transcript prêt", "Analyse requise", "Résultat prêt à vérifier", "Ajoutée à la bibliothèque", "En pause", "Annulée", "Échec"];

function queueItem(state: VideoQueueItemState, index: number): VideoQueueItem {
  const prefix = (index + 1).toString().padStart(8, "0");
  return {
    itemId: `${prefix}-1111-4111-8111-111111111111`,
    workflowId: state === "queued" ? undefined : `${prefix}-2222-4222-8222-222222222222`,
    createdAt: `2026-07-28T12:${index.toString().padStart(2, "0")}:00.000Z`, updatedAt: "2026-07-28T13:00:00.000Z",
    canonicalUrl: `https://www.youtube.com/watch?v=fixture_${index.toString().padStart(4, "0")}`,
    videoId: `fixture_${index.toString().padStart(4, "0")}`,
    title: `Conférence pratique : reconstruire une base de connaissances personnelle avec des notes, des décisions et des exemples concrets pour la suite ${index + 1}`,
    state, attemptCount: 1,
    ...(state === "paused" ? { pauseReason: "source-selection-required" as const, resumeState: "transcribing" as const } : {}),
    ...(state === "failed" ? { lastErrorCode: "YOUTUBE_RATE_LIMITED" } : {}),
  };
}

function queue(items = states.map(queueItem), paused = false): VideoQueueSnapshot {
  return { revision: 11, paused, activeItemId: paused ? null : items.find((item) => item.state === "inspecting")?.itemId ?? null, items, history: [] };
}

const emptyQueue = queue([], false);

async function fulfill(route: Route, payload: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

async function mockQueueApi(page: Page, initial = queue()) {
  let current = structuredClone(initial);
  let reconcileCount = 0;
  let addCount = 0;
  await page.route(/\/api\/video-queue(?:\/.*)?$/, async (route) => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() !== "POST") return route.continue();
    if (url.pathname === "/api/video-queue/reconcile") { reconcileCount++; return fulfill(route, { queue: current }); }
    if (url.pathname === "/api/video-queue/pause") { current = { ...current, paused: true }; return fulfill(route, { queue: current }); }
    if (url.pathname === "/api/video-queue/resume") { current = { ...current, paused: false }; return fulfill(route, { queue: current }); }
    if (/\/cancel$/.test(url.pathname)) {
      const id = url.pathname.split("/").at(-2); current = { ...current, items: current.items.map((item) => item.itemId === id ? { ...item, state: "cancelled" as const } : item) };
      return fulfill(route, { queue: current });
    }
    if (/\/retry$/.test(url.pathname)) {
      const id = url.pathname.split("/").at(-2); current = { ...current, items: current.items.map((item) => item.itemId === id ? { ...item, state: "transcribing" as const, lastErrorCode: undefined } : item) };
      return fulfill(route, { queue: current });
    }
    if (url.pathname === "/api/video-queue") {
      addCount++;
      const workflowId = "99999999-2222-4222-8222-222222222222";
      const results: AddVideoResult[] = [
        { inputIndex: 0, status: "accepted", itemId: "99999999-1111-4111-8111-111111111111", canonicalUrl: "https://www.youtube.com/watch?v=accepted01", videoId: "accepted01" },
        { inputIndex: 1, status: "duplicate", videoId: "accepted01", duplicates: [{ kind: "submission", imported: false }] },
        { inputIndex: 2, status: "duplicate", videoId: "inqueue001", duplicates: [{ kind: "queue", imported: false }] },
        { inputIndex: 3, status: "duplicate", videoId: "workflow01", duplicates: [{ kind: "workflow", workflowId, imported: false }] },
        { inputIndex: 4, status: "duplicate", videoId: "library001", duplicates: [{ kind: "library", imported: true }] },
        { inputIndex: 5, status: "rejected", errorCode: "INVALID_YOUTUBE_URL" },
      ];
      return fulfill(route, { results, queue: current }, 201);
    }
    return route.continue();
  });
  return { get reconcileCount() { return reconcileCount; }, get addCount() { return addCount; } };
}

async function open(page: Page, target = "/video-queue") {
  const response = await page.goto(target, { waitUntil: "networkidle" });
  expect(response?.status()).toBeLessThan(400);
  await expect(page.locator("main")).toBeVisible();
}

async function assertSafeResponsive(page: Page) {
  const body = await page.locator("body").innerText();
  expect(body).not.toContain(qaRoot); expect(body).not.toMatch(/[A-Z]:\\(?:Users|Windows|Program Files)\\/i); expect(body).not.toContain("OPENAI_API_KEY");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)).toBe(false);
}

test.describe.configure({ mode: "serial" });

test("file vide, navigation claire et saisie multiligne accessible", async ({ page }) => {
  await mockQueueApi(page, emptyQueue); await page.setViewportSize({ width: 1440, height: 900 }); await open(page);
  await expect(page.getByRole("heading", { name: "La file est vide" })).toBeVisible();
  const input = page.getByLabel("URLs YouTube, une par ligne");
  await input.fill("  https://youtu.be/abcDEF_1234  \n\nhttps://youtube.com/shorts/xyzABC_9876\n");
  await expect(page.getByText("2 / 100 lignes")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ajouter à la file" })).toBeEnabled();
  await assertSafeResponsive(page);
  await open(page, "/add-video"); await expect(page.getByRole("link", { name: "Ajouter plusieurs vidéos" })).toHaveAttribute("href", "/video-queue");
  await open(page, "/workflows"); await expect(page.getByRole("link", { name: "Ouvrir la file" })).toHaveAttribute("href", "/video-queue");
});

test("soumission mixte, six catégories et prévention du double clic", async ({ page }) => {
  const api = await mockQueueApi(page, emptyQueue); await open(page);
  await page.getByLabel("URLs YouTube, une par ligne").fill(["https://youtu.be/accepted01", "https://youtu.be/accepted01", "https://youtu.be/inqueue001", "https://youtu.be/workflow01", "https://youtu.be/library001", "pas une url"].join("\n"));
  const submit = page.getByRole("button", { name: "Ajouter à la file" });
  await submit.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole("heading", { name: "Résultat de l’ajout" })).toBeVisible();
  for (const title of ["Vidéos ajoutées", "Doublons dans la soumission", "Déjà dans la file", "Workflow déjà existant", "Vidéo déjà analysée", "URL invalide"]) await expect(page.getByText(new RegExp(`^${title}`))).toBeVisible();
  expect(api.addCount).toBe(1);
  await expect(page.getByRole("link", { name: "Ouvrir le traitement existant" })).toHaveAttribute("href", /\/workflows\//);
});

test("dix états, prochaines actions et lien de décision humaine", async ({ page }) => {
  await mockQueueApi(page); await open(page);
  for (const title of stateTitles) await expect(page.getByText(title, { exact: true })).toBeVisible();
  const paused = page.locator('[data-queue-state="paused"]');
  await expect(paused.getByText("Choisir la transcription dans le traitement individuel.")).toBeVisible();
  await expect(paused.getByRole("link", { name: "Choisir la transcription" })).toHaveAttribute("href", /\/workflows\//);
  await expect(page.locator('[data-queue-state="failed"]').getByRole("alert")).toContainText("YouTube limite temporairement");
});

test("réconcilie l’état persistant au premier chargement après un redémarrage simulé", async ({ page }) => {
  const persisted = queue([queueItem("paused", 7)], true);
  const api = await mockQueueApi(page, persisted);
  await open(page);
  await expect(page.getByText("En pause", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reprendre la file" })).toBeVisible();
  expect(api.reconcileCount).toBe(1);
});

test("pause, reprise, annulation, retry et réconciliation idempotents côté interface", async ({ page }) => {
  const api = await mockQueueApi(page); await open(page);
  await page.getByRole("button", { name: "Mettre en pause" }).click();
  await expect(page.getByRole("button", { name: "Reprendre la file" })).toBeVisible();
  await page.getByRole("button", { name: "Reprendre la file" }).click();
  await expect(page.getByRole("button", { name: "Mettre en pause" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-queue-state="queued"]').getByRole("button", { name: "Annuler" }).click();
  await expect(page.locator('[data-queue-state="cancelled"]')).toHaveCount(2);
  await page.locator('[data-queue-state="failed"]').getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByText("Nouvelle tentative lancée sur le même traitement.")).toBeVisible();
  await page.getByRole("button", { name: "Actualiser l’état" }).click();
  expect(api.reconcileCount).toBeGreaterThanOrEqual(2);
});

test("polling borné et timer nettoyé au démontage", async ({ page }) => {
  const api = await mockQueueApi(page); await open(page);
  await page.waitForTimeout(4_500);
  expect(api.reconcileCount).toBeGreaterThanOrEqual(2); expect(api.reconcileCount).toBeLessThanOrEqual(3);
  await page.goto("/add-video", { waitUntil: "networkidle" }); const stoppedAt = api.reconcileCount;
  await page.waitForTimeout(4_500); expect(api.reconcileCount).toBe(stoppedAt);
});

test("desktop et mobile sans fuite, écriture vault ni session Apply", async ({ page }) => {
  await mockQueueApi(page); const before = createHash("sha256").update(await readFile(path.join(vault, "INDEX.md"))).update(await readFile(path.join(vault, "02_SOURCES", "videos.md"))).digest("hex");
  await page.setViewportSize({ width: 1440, height: 900 }); await open(page); await assertSafeResponsive(page);
  await page.setViewportSize({ width: 390, height: 844 }); await open(page); await assertSafeResponsive(page);
  const after = createHash("sha256").update(await readFile(path.join(vault, "INDEX.md"))).update(await readFile(path.join(vault, "02_SOURCES", "videos.md"))).digest("hex");
  expect(after).toBe(before);
  await expect(readdir(sessions)).rejects.toMatchObject({ code: "ENOENT" });
});

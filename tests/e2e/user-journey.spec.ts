import { expect, test, type Page, type Route } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AddVideoResult, VideoQueueSnapshot } from "../../src/lib/video-queue/engine";
import type { VideoQueueItem } from "../../src/lib/video-queue/schema";

const qaRoot = path.join(os.tmpdir(), "tubeknowledge-user-journey-qa");
const now = "2026-09-09T12:00:00.000Z";

type Fixture = {
  vault: string;
  runtime: string;
  state: string;
  mockZip: string;
  ids: Record<string, string>;
};

function item(index: number, state: VideoQueueItem["state"], overrides: Partial<VideoQueueItem> = {}): VideoQueueItem {
  const prefix = (index + 1).toString().padStart(8, "0");
  return {
    itemId: `${prefix}-1111-4111-8111-111111111111`,
    createdAt: now,
    updatedAt: now,
    canonicalUrl: `https://www.youtube.com/watch?v=valid${index.toString().padStart(6, "0")}`,
    videoId: `valid${index.toString().padStart(6, "0")}`,
    title: `Vidéo fixture ${index + 1}`,
    state,
    attemptCount: 1,
    ...overrides,
  };
}

function snapshot(items: VideoQueueItem[], paused = false): VideoQueueSnapshot {
  return { revision: 1, paused, activeItemId: null, items, history: [] };
}

async function fixture(): Promise<Fixture> {
  return JSON.parse(await readFile(path.join(qaRoot, "fixture.json"), "utf8")) as Fixture;
}

async function open(page: Page, target: string) {
  const response = await page.goto(target, { waitUntil: "networkidle" });
  expect(response?.status(), `Écran inaccessible : ${target}`).toBeLessThan(400);
  await expect(page.locator("main").first()).toBeVisible();
  const visible = await page.locator("body").innerText();
  expect(visible).not.toContain(qaRoot);
}

async function activateTemporaryWriter(value: Fixture) {
  const authorityPath = path.join(value.vault, ".tubeknowledge", "portability", "writer-authority.json");
  const authority = JSON.parse(await readFile(authorityPath, "utf8")) as { expiresAt: string };
  authority.expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await writeFile(authorityPath, `${JSON.stringify(authority, null, 2)}\n`, "utf8");
}

async function previewAndApply(page: Page, value: Fixture) {
  await open(page, "/imports");
  await page.locator("#import-package").setInputFiles(value.mockZip);
  await page.getByRole("button", { name: "Prévisualiser sans appliquer" }).click();
  await expect(page.getByText("Analyse de démonstration")).toBeVisible();
  await page.getByLabel("Je confirme l’ajout de tous les changements présentés ci-dessus.").check();
  await page.getByRole("button", { name: "Ajouter avec sauvegarde" }).click();
  await expect(page.getByRole("heading", { name: "Ajout réussi" })).toBeVisible();
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockDeterministicQueue(page: Page) {
  const failed = item(7, "failed", { canonicalUrl: "https://www.youtube.com/watch?v=inaccess001", videoId: "inaccess001", lastErrorCode: "QUEUE_INSPECTION_FAILED" });
  let current = snapshot([item(0, "queued"), item(1, "paused", { pauseReason: "source-selection-required", resumeState: "transcribing", workflowId: "20000000-0000-4000-8000-000000000001" })]);
  let addCalls = 0;
  await page.route(/\/api\/video-queue(?:\/.*)?$/, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.continue();
    const pathname = new URL(request.url()).pathname;
    if (pathname === "/api/video-queue") {
      addCalls += 1;
      const results: AddVideoResult[] = [
        ...Array.from({ length: 6 }, (_, inputIndex) => ({ inputIndex, status: "accepted" as const, itemId: item(inputIndex, "queued").itemId, canonicalUrl: item(inputIndex, "queued").canonicalUrl, videoId: item(inputIndex, "queued").videoId })),
        { inputIndex: 6, status: "duplicate", videoId: "valid000000", duplicates: [{ kind: "submission", imported: false }] },
        { inputIndex: 7, status: "duplicate", videoId: "valid000001", duplicates: [{ kind: "submission", imported: false }] },
        { inputIndex: 8, status: "rejected", errorCode: "INVALID_YOUTUBE_URL" },
        { inputIndex: 9, status: "accepted", itemId: failed.itemId, canonicalUrl: failed.canonicalUrl, videoId: failed.videoId },
      ];
      current = snapshot([...current.items, ...Array.from({ length: 6 }, (_, index) => item(index + 10, "queued")), failed]);
      return fulfill(route, { results, queue: current }, 201);
    }
    if (pathname === "/api/video-queue/pause") { current = { ...current, paused: true }; return fulfill(route, { queue: current }); }
    if (pathname === "/api/video-queue/resume") { current = { ...current, paused: false }; return fulfill(route, { queue: current }); }
    if (pathname === "/api/video-queue/reconcile") return fulfill(route, { queue: current });
    if (pathname.endsWith("/cancel")) {
      const id = pathname.split("/").at(-2);
      current = { ...current, items: current.items.map((entry) => entry.itemId === id ? { ...entry, state: "cancelled" as const } : entry) };
      return fulfill(route, { queue: current });
    }
    if (pathname.endsWith("/retry")) {
      const id = pathname.split("/").at(-2);
      current = { ...current, items: current.items.map((entry) => entry.itemId === id ? { ...entry, state: "queued" as const, lastErrorCode: undefined } : entry) };
      return fulfill(route, { queue: current });
    }
    return route.continue();
  });
  return { get addCalls() { return addCalls; } };
}

test.describe.configure({ mode: "serial" });

test("bibliothèque — la navigation de lecture expose les domaines et les notions de la fixture", async ({ page }) => {
  await open(page, "/library");
  await expect(page.getByRole("heading", { name: "Domaines" })).toBeVisible();
  const domain = page.getByRole("link", { name: "Astronomie" }).first();
  await expect(domain).toBeVisible();
  await domain.click();
  await expect(page.getByRole("heading", { name: "Astronomie" })).toBeVisible();
  await page.getByRole("link", { name: "Observation" }).click();
  await expect(page.getByRole("heading", { name: "Observation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "observer-le-ciel" }).first()).toBeVisible();
});

test("A — une vidéo traverse les vrais écrans jusqu’à une citation ouvrable", async ({ page }) => {
  const value = await fixture();
  await activateTemporaryWriter(value);

  await open(page, "/");
  await page.getByRole("link", { name: "Ajouter" }).first().click();
  await expect(page.getByRole("heading", { name: "Ajouter des vidéos", level: 1 })).toBeVisible();
  await expect(page.getByLabel("URLs YouTube")).toBeVisible();

  // Les étapes externes sont déjà inspectées dans la fixture. Les écrans, liens,
  // Preview et Apply restent ceux de l’application en cours d’exécution.
  await open(page, `/workflows/${value.ids.selection}`);
  await expect(page.getByRole("heading", { name: "Choisir la transcription" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Utiliser la piste sélectionnée" })).toBeVisible();
  await open(page, `/workflows/${value.ids.transcript}`);
  await expect(page.getByRole("heading", { name: "Transcript prêt" })).toBeVisible();
  await page.getByRole("link", { name: "Préparer l’analyse" }).click();
  await expect(page.getByRole("heading", { name: /Préparer.*analyse/i })).toBeVisible();
  await open(page, `/workflows/${value.ids.analysis}`);
  await page.getByRole("link", { name: "Continuer l’analyse manuelle" }).click();
  await expect(page.getByText("Analyse manuelle en trois étapes")).toBeVisible();

  await previewAndApply(page, value);
  await page.getByRole("link", { name: "Retrouver les connaissances" }).click();
  await open(page, "/library");
  await page.locator("#global-search").fill("horizon");
  await page.getByRole("button", { name: "Chercher" }).click();
  await expect(page.getByText(/résultat/)).toBeVisible();

  await open(page, "/ask");
  await page.locator("#library-question").fill("Quels repères aident à observer le ciel ?");
  await page.getByRole("button", { name: "Interroger la bibliothèque" }).click();
  await expect(page.getByRole("heading", { name: "Réponse fondée sur les sources" })).toBeVisible();
  const citation = page.getByRole("link", { name: /01_BIBLIOTHEQUE\/Astronomie\/Observation\/observer-le-ciel\.md/ }).first();
  await expect(citation).toBeVisible();
  await citation.click();
  await expect(page.getByRole("heading", { name: "Observer le ciel" })).toBeVisible();
});

test("B — file déterministe de 10 URL : concurrence 1, pause, reprise, annulation, retry et persistance simulée", async ({ page }) => {
  const api = await mockDeterministicQueue(page);
  await open(page, "/video-queue");
  await expect(page.getByText("Les vidéos sont traitées une à la fois.")).toBeVisible();
  const urls = [
    "https://www.youtube.com/watch?v=valid000000", "https://www.youtube.com/watch?v=valid000001", "https://www.youtube.com/watch?v=valid000002",
    "https://www.youtube.com/watch?v=valid000003", "https://www.youtube.com/watch?v=valid000004", "https://www.youtube.com/watch?v=valid000005",
    "https://www.youtube.com/watch?v=valid000000", "https://youtu.be/valid000001", "pas-une-url", "https://www.youtube.com/watch?v=inaccess001",
  ];
  await page.getByLabel("URLs YouTube").fill(urls.join("\n"));
  const add = page.getByRole("button", { name: "Ajouter" });
  await add.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole("heading", { name: "Résultat de l’ajout" })).toBeVisible();
  for (const label of ["Vidéos ajoutées", "Doublons dans la soumission", "URL invalide"]) await expect(page.getByText(new RegExp(`^${label}`))).toBeVisible();
  expect(api.addCalls).toBe(1);

  await page.getByRole("button", { name: "Mettre en pause" }).click();
  await expect(page.getByText("Traitement mis en pause.")).toBeVisible();
  await page.getByRole("button", { name: "Reprendre" }).click();
  await expect(page.getByText("Traitement repris.")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('[data-queue-state="queued"]').first().getByRole("button", { name: "Annuler" }).click();
  await expect(page.getByText("Élément annulé. Les connaissances existantes sont conservées.")).toBeVisible();
  await page.locator('[data-queue-state="failed"]').first().getByRole("button", { name: "Réessayer" }).click();
  await expect(page.getByText("Nouvelle tentative lancée.")).toBeVisible();

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("Annulée", { exact: true })).toBeVisible();
  await expect(page.locator('[data-queue-state="queued"]')).not.toHaveCount(0);
  await expect(page.getByRole("link", { name: "Vérifier" })).toBeVisible();
});

test("C — les échecs exposent une action suivante sans atteindre le vrai vault", async ({ page }) => {
  const value = await fixture();

  await open(page, "/imports");
  await page.locator("#import-package").setInputFiles({ name: "invalide.zip", mimeType: "application/zip", buffer: Buffer.from("pas un zip") });
  await page.getByRole("button", { name: "Prévisualiser sans appliquer" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Choisissez un ZIP de résultat valide" })).toBeVisible();

  await open(page, `/workflows/${value.ids.blocked}`);
  await expect(page.getByText("Écriture indisponible")).toBeVisible();
  await expect(page.getByRole("link", { name: "Gérer l’autorisation d’écriture" })).toBeVisible();

  await open(page, `/workflows/${value.ids.acquiring}`);
  await expect(page.getByRole("link", { name: "Gérer ou annuler" })).toBeVisible();

  const unavailableJobPath = path.join(value.runtime, "acquisitions", value.ids.acquiring, "job.json");
  const unavailableJob = JSON.parse(await readFile(unavailableJobPath, "utf8")) as Record<string, unknown>;
  Object.assign(unavailableJob, {
    status: "failed",
    stage: "failed",
    progress: null,
    message: "La piste de sous-titres choisie n’est plus disponible. Actualisez l’inspection puis choisissez une piste existante.",
    error: {
      code: "SUBTITLE_NOT_AVAILABLE",
      message: "La piste de sous-titres choisie n’est plus disponible. Actualisez l’inspection puis choisissez une piste existante.",
    },
  });
  await writeFile(unavailableJobPath, `${JSON.stringify(unavailableJob, null, 2)}\n`, "utf8");
  await open(page, `/acquisitions/${value.ids.acquiring}`);
  await expect(page.getByRole("alert").filter({ hasText: "SUBTITLE_NOT_AVAILABLE" })).toContainText("Actualisez l’inspection puis choisissez une piste existante.");

  await writeFile(path.join(value.state, "conflicts.json"), `${JSON.stringify([{
    schemaVersion: 1,
    conflictId: "70000000-0000-4000-8000-000000000001",
    type: "content-divergence",
    detectedAt: now,
    paths: ["02_SOURCES/videos.md"],
    severity: "blocking",
    status: "open",
    evidence: { reason: "Conflit fixture pour action visible." },
  }], null, 2)}\n`, "utf8");
  await open(page, "/portability");
  await expect(page.getByRole("link", { name: "Examiner le conflit" })).toBeVisible();

  // La prévisualisation expirée et le writer expiré sont des erreurs serveur
  // contrôlées; les doublures restent dans le navigateur et vérifient le texte
  // réellement rendu par ImportWorkbench.
  await page.route("**/api/imports/preview", async (route) => fulfill(route, { preview: {
    sessionId: "30000000-0000-4000-8000-000000000099", source: { type: "manual-notes", title: "Fixture" }, summary: "Fixture", review: "Fixture", operations: [], structuralChange: { level: "none", confirmationRequired: false, summary: "Aucune" }, canApply: true,
  } }));
  await page.route("**/api/imports/apply", async (route) => fulfill(route, { result: { status: "rejected", message: "L’autorité writer locale est expirée.", failure: { code: "WRITER_EXPIRED", message: "L’autorité writer locale est expirée.", action: "Gérez writer, puis réessayez.", retryable: true, requiresNewPreview: false } } }, 409));
  await open(page, "/imports");
  await page.locator("#import-package").setInputFiles(value.mockZip);
  await page.getByRole("button", { name: "Prévisualiser sans appliquer" }).click();
  await page.getByLabel("Je confirme l’ajout de tous les changements présentés ci-dessus.").check();
  await page.getByRole("button", { name: "Ajouter avec sauvegarde" }).click();
  await expect(page.getByRole("link", { name: "Gérer writer" })).toBeVisible();
  await expect(page.getByText("Cette session reste réutilisable.")).toBeVisible();

  await page.unroute("**/api/imports/apply");
  await page.route("**/api/imports/apply", async (route) => fulfill(route, { error: { message: "Cette vérification a expiré.", action: "Prévalidez de nouveau le ZIP retourné." } }, 410));
  await page.getByRole("button", { name: "Réessayer l’ajout" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Prévalidez de nouveau le ZIP retourné." })).toBeVisible();

  await open(page, "/portability/conflicts");
  await expect(page.getByText("content-divergence")).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const qaRoot = path.join(os.tmpdir(), "tubeknowledge-phase10-4-playwright");
const reportRoot = path.resolve("reports", "phase-10-4-qa", "playwright");

interface Fixture {
  vault: string;
  workflowRoot: string;
  sessions: string;
  ids: { packageOne: string; packageTwo: string; workflowOne: string; workflowTwo: string };
  resultOne: string;
  resultTwo: string;
}

let fixture: Fixture;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fixture = JSON.parse(await readFile(path.join(qaRoot, "fixture.json"), "utf8")) as Fixture;
  await mkdir(reportRoot, { recursive: true });
});

async function uploadResult(page: Page, packageId: string, zipPath: string) {
  await page.goto(`/chatgpt-packages/${packageId}/result`, { waitUntil: "networkidle" });
  await page.getByLabel("Importer le ZIP retourné").setInputFiles(zipPath);
  await page.locator("button", { hasText: "Importer le ZIP retourné" }).click();
  await expect(page.getByText("Résultat prêt à vérifier.")).toBeVisible();
  await expect(page.getByText("01_BIBLIOTHEQUE/Test/", { exact: false }).first()).toBeVisible();
}

async function confirmAndApply(page: Page, buttonName: string | RegExp) {
  await page.getByLabel("Je confirme l’ajout de tous les changements présentés ci-dessus.").check();
  await page.getByLabel(/saisissez exactement APPLIQUER/i).fill("APPLIQUER");
  await page.getByRole("button", { name: buttonName }).click();
}

async function workflowSessionId(workflowId: string, differentFrom?: string): Promise<string> {
  const deadline = Date.now() + 5_000;
  do {
    const workflow = JSON.parse(await readFile(path.join(fixture.workflowRoot, `${workflowId}.json`), "utf8")) as { previewSessionId?: string };
    if (workflow.previewSessionId && workflow.previewSessionId !== differentFrom) return workflow.previewSessionId;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  throw new Error("previewSessionId absent de la fixture QA.");
}

async function activateTemporaryWriter() {
  const writerPath = path.join(fixture.vault, ".tubeknowledge", "portability", "writer-authority.json");
  const writer = JSON.parse(await readFile(writerPath, "utf8")) as { expiresAt: string };
  writer.expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await writeFile(writerPath, `${JSON.stringify(writer, null, 2)}\n`, "utf8");
}

async function transactionBackupCount() {
  try { return (await readdir(path.join(fixture.vault, ".backups", "imports"), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
}

test("upload, Preview, erreur writer récupérable, reprise, succès, rafraîchissement et replay", async ({ page, request }) => {
  await uploadResult(page, fixture.ids.packageOne, fixture.resultOne);
  const sessionId = await workflowSessionId(fixture.ids.workflowOne);

  await confirmAndApply(page, "Ajouter avec sauvegarde");
  await expect(page.getByRole("heading", { name: "Ajout refusé" })).toBeVisible();
  await expect(page.getByText("L’autorité writer locale est expirée.")).toBeVisible();
  await expect(page.getByText("Cette session reste réutilisable.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Gérer writer" })).toBeVisible();
  await page.screenshot({ path: path.join(reportRoot, "01-writer-expire-session-reutilisable.png"), fullPage: true });

  await activateTemporaryWriter();
  await page.getByRole("button", { name: "Réessayer l’ajout" }).click();
  await expect(page.getByRole("heading", { name: "Ajout réussi" })).toBeVisible();
  const backupCount = await transactionBackupCount();
  const historyPath = path.join(fixture.vault, ".tubeknowledge", "import-history.jsonl");
  const historyCount = (await readFile(historyPath, "utf8")).trim().split(/\r?\n/).length;

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Ajout réussi" })).toBeVisible();
  await page.screenshot({ path: path.join(reportRoot, "02-succes-apres-rafraichissement.png"), fullPage: true });

  const replay = await request.post("/api/imports/apply", { data: { sessionId, confirmed: true, confirmationText: "APPLIQUER" } });
  expect(replay.status()).toBe(200);
  expect((await replay.json()).result).toMatchObject({ status: "success", idempotent: true });
  expect(await transactionBackupCount()).toBe(backupCount);
  expect((await readFile(historyPath, "utf8")).trim().split(/\r?\n/)).toHaveLength(historyCount);
});

test("session expirée, message public précis et recréation avec le même ZIP", async ({ page }) => {
  await uploadResult(page, fixture.ids.packageTwo, fixture.resultTwo);
  const expiredSessionId = await workflowSessionId(fixture.ids.workflowTwo);
  const sessionPath = path.join(fixture.sessions, `${expiredSessionId}.json`);
  const session = JSON.parse(await readFile(sessionPath, "utf8")) as { expiresAt: string };
  session.expiresAt = new Date(Date.now() - 60_000).toISOString();
  await writeFile(sessionPath, `${JSON.stringify(session)}\n`, "utf8");

  await confirmAndApply(page, "Ajouter avec sauvegarde");
  const expiredAlert = page.locator('div[role="alert"]').filter({ hasText: "Cette vérification a expiré." });
  await expect(expiredAlert).toContainText("Cette vérification a expiré.");
  await expect(expiredAlert).toContainText("Prévalidez de nouveau le ZIP retourné.");
  await expect(page.locator("button", { hasText: "Importer le ZIP retourné" })).toBeVisible();
  await page.screenshot({ path: path.join(reportRoot, "03-session-expiree-action-recreation.png"), fullPage: true });

  await page.getByLabel("Importer le ZIP retourné").setInputFiles(fixture.resultTwo);
  await page.locator("button", { hasText: "Importer le ZIP retourné" }).click();
  await expect(page.getByText("Résultat prêt à vérifier.")).toBeVisible();
  const recreatedSessionId = await workflowSessionId(fixture.ids.workflowTwo, expiredSessionId);
  expect(recreatedSessionId).not.toBe(expiredSessionId);
  await confirmAndApply(page, "Ajouter avec sauvegarde");
  await expect(page.getByRole("heading", { name: "Ajout réussi" })).toBeVisible();
  await page.screenshot({ path: path.join(reportRoot, "04-preview-recree-succes.png"), fullPage: true });
});

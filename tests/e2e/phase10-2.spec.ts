import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..", "..");
const reportRoot = path.join(projectRoot, "reports", "phase-10-2-qa");
const screenshotRoot = path.join(reportRoot, "screenshots");
const qaRoot = path.join(os.tmpdir(), "tubeknowledge-playwright-qa");

type Fixture = {
  ids: Record<string, string>;
  requestZip: string;
  validResultZip: string;
};

type Capture = {
  name: string;
  page: string;
  state: string;
  resolution: string;
  expected: string;
  observed: string;
};

let fixture: Fixture;
const captures: Capture[] = [];
const consoleErrors: string[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await rm(reportRoot, { recursive: true, force: true });
  await mkdir(screenshotRoot, { recursive: true });
  fixture = JSON.parse(await readFile(path.join(qaRoot, "fixture.json"), "utf8")) as Fixture;
});

function monitor(page: Page) {
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("400 (Bad Request)")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
}

async function open(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: "networkidle" });
  expect(response, `Réponse absente pour ${url}`).not.toBeNull();
  expect(response!.status(), `Erreur HTTP pour ${url}`).toBeLessThan(400);
  await expect(page.locator("main").first()).toBeVisible();
}

async function assertNoOverflow(page: Page, context: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(overflow, `Débordement horizontal: ${context}`).toBe(false);
}

async function capture(page: Page, name: string, pageName: string, state: string, expected: string) {
  const viewport = page.viewportSize();
  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(/[A-Z]:\\(?:Users|Program Files|Windows)\\/i);
  expect(visibleText).not.toContain(qaRoot);
  await assertNoOverflow(page, name);
  const destination = path.join(screenshotRoot, `${name}.png`);
  await page.screenshot({ path: destination, fullPage: true });
  expect((await stat(destination)).size).toBeGreaterThan(5_000);
  captures.push({
    name,
    page: pageName,
    state,
    resolution: `${viewport?.width ?? 0}x${viewport?.height ?? 0}`,
    expected,
    observed: "État principal lisible, aucune fuite de chemin absolu et aucun débordement horizontal.",
  });
}

async function exerciseAdvancedMenu(page: Page) {
  const button = page.getByRole("button", { name: "Avancé" });
  await expect(button).toBeVisible();
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const menu = page.getByRole("menu", { name: "Navigation avancée" });
  await expect(menu).toBeVisible();
  for (const label of ["Acquisitions", "Paquets d’analyse", "Imports sécurisés", "Portabilité", "Diagnostic", "Paramètres de transcription"]) {
    await expect(menu.getByRole("menuitem", { name: label })).toBeVisible();
  }
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();
  await page.keyboard.press("Space");
  await expect(menu).toBeVisible();
}

test("navigation avancée accessible aux quatre largeurs et dans les deux thèmes", async ({ page }) => {
  monitor(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/");
  await page.evaluate(() => { localStorage.setItem("tubeknowledge-theme", "light"); document.documentElement.classList.remove("dark"); document.documentElement.classList.add("light"); });
  await exerciseAdvancedMenu(page);
  await capture(page, "01-header-avance-desktop", "/", "menu avancé ouvert, thème clair", "Les six destinations sont visibles et le libellé Avancé est entier.");
  await page.getByRole("menuitem", { name: "Diagnostic" }).click();
  await expect(page).toHaveURL(/\/diagnostics$/);
  await expect(page.getByRole("button", { name: "Avancé" })).toHaveAttribute("aria-expanded", "false");

  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, "/");
  await page.getByRole("button", { name: "Basculer entre le thème clair et le thème sombre" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await exerciseAdvancedMenu(page);
  await capture(page, "02-header-avance-tablette", "/", "menu avancé ouvert, thème sombre", "Le menu reste lisible à 1024 px en thème sombre.");

  await page.setViewportSize({ width: 768, height: 900 });
  await open(page, "/");
  await exerciseAdvancedMenu(page);
  await assertNoOverflow(page, "navigation 768 px");
  await page.mouse.click(8, 500);
  await expect(page.getByRole("button", { name: "Avancé" })).toHaveAttribute("aria-expanded", "false");

  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/");
  await page.getByRole("button", { name: "Basculer entre le thème clair et le thème sombre" }).click();
  await exerciseAdvancedMenu(page);
  await capture(page, "03-header-avance-mobile", "/", "menu avancé ouvert sur mobile", "Le bouton et les six destinations restent utilisables à 390 px.");
});

test("erreur URL précise et parcours manuel sans identifiant dominant", async ({ page }) => {
  monitor(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/add-video");
  await page.locator("#workflow-source-url").fill("https://example.com/not-youtube");
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/workflows") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Continuer" }).click();
  expect((await responsePromise).status()).toBe(400);
  await expect(page.getByRole("alert").filter({ hasText: "Entrez une URL YouTube valide." })).toBeVisible();
  await capture(page, "04-url-invalide", "/add-video", "URL non YouTube refusée", "Le message explique précisément que l’URL doit être une URL YouTube.");

  await open(page, `/chatgpt-packages/${fixture.ids.package}`);
  await expect(page.getByRole("heading", { name: "Analyse manuelle en trois étapes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1. Télécharger le paquet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2. Copier l’instruction" })).toBeVisible();
  await expect(page.getByRole("link", { name: "3. Importer le ZIP retourné" })).toBeVisible();
  await expect(page.getByText(`Identifiant : ${fixture.ids.package}`)).not.toBeVisible();
  await capture(page, "05-parcours-paquet-manuel", "/chatgpt-packages/[id]", "paquet d’analyse prêt", "Les trois actions principales distinguent clairement le ZIP envoyé du ZIP retourné.");
});

test("mauvais ZIP explicite puis bon ZIP accepté sans rechargement", async ({ page }) => {
  monitor(page);
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page, `/chatgpt-packages/${fixture.ids.package}/result?workflowId=${fixture.ids.analysis}`);
  let uploadRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes(`/api/chatgpt-packages/${fixture.ids.package}/result`)) uploadRequests += 1;
  });

  const input = page.locator("#chatgpt-result");
  const submit = page.locator("button").filter({ hasText: /^Importer le ZIP retourné$/ });
  await input.setInputFiles(fixture.requestZip);
  await submit.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole("alert").filter({ hasText: "Ce fichier est le paquet à envoyer à ChatGPT" })).toContainText("Ce fichier est le paquet à envoyer à ChatGPT, pas le résultat de l’analyse.");
  await expect(submit).toBeEnabled();
  expect(uploadRequests).toBe(1);
  await capture(page, "06-mauvais-zip-message", "/chatgpt-packages/[id]/result", "paquet source refusé", "Le mauvais fichier est identifié, aucun détail technique ne domine et une nouvelle sélection est possible.");

  await input.setInputFiles(fixture.validResultZip);
  await submit.click();
  await expect(page.getByText("Résultat prêt à vérifier.")).toBeVisible();
  expect(uploadRequests).toBe(2);
  await capture(page, "07-bon-zip-accepte", "/chatgpt-packages/[id]/result", "résultat compatible prévisualisé", "Le bon ZIP est accepté immédiatement après le refus, sans écriture dans le vault.");
});

test("diagnostic orienté action et sans prétention cloud", async ({ page }) => {
  monitor(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, "/diagnostics");
  await expect(page.getByText("Écriture autorisée sur cette machine").first()).toBeVisible();
  await expect(page.getByText("Aucun conflit de contenu ne bloque la bibliothèque.")).toBeVisible();
  await expect(page.getByText("Synchronisation cloud non vérifiée.")).toBeVisible();
  await capture(page, "08-diagnostic-humain", "/diagnostics", "writer et conflits présentés humainement", "L’état writer, les sauvegardes et les conflits sont compréhensibles; le cloud reste explicitement non vérifié.");
  expect(consoleErrors, `Erreurs navigateur: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test.afterAll(async () => {
  expect(captures).toHaveLength(8);
  const rows = captures.map((item) => `| ${item.name} | \`${item.page}\` | ${item.state} | ${item.resolution} | ${item.observed} |`).join("\n");
  const images = captures.map((item) => `### ${item.name}\n\n![${item.state}](screenshots/${item.name}.png)\n\nAttendu : ${item.expected}\n\nObservé : ${item.observed}`).join("\n\n");
  await writeFile(path.join(reportRoot, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), fixture: "seed-phase-10-2-qa", captures }, null, 2)}\n`, "utf8");
  await writeFile(path.join(reportRoot, "index.md"), `# QA visuelle Phase 10.2\n\nFixture entièrement temporaire. Les captures couvrent 1440×900, 1024×768 et 390×844; la largeur 768×900 est aussi exercée automatiquement. Le menu est testé à la souris et au clavier, en clair et sombre. Aucun appel IA, aucune écriture dans le vault réel.\n\n| Capture | Page | État | Résolution | Observation |\n|---|---|---|---|---|\n${rows}\n\n## Captures\n\n${images}\n`, "utf8");
});

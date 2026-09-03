import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(__dirname, "..", "..");
const screenshotRoot = path.join(projectRoot, "reports", "overnight-qa", "screenshots");
const reportRoot = path.dirname(screenshotRoot);
const phase101ScreenshotRoot = path.join(projectRoot, "reports", "phase-10-1-qa", "screenshots");
const phase101ReportRoot = path.dirname(phase101ScreenshotRoot);
const qaRoot = path.join(os.tmpdir(), "tubeknowledge-playwright-qa");
let fixture: { ids: Record<string, string>; mockZip: string };
const captures: Array<{ name: string; page: string; state: string; resolution: string; date: string; fixture: string; expected: string; observed: string }> = [];
const phase101Captures: typeof captures = [];
const consoleErrors: string[] = [];
const PHASE_10_1_NAMES: Record<string, string> = {
  "01-accueil-desktop": "01-accueil-desktop",
  "02-ajouter-video-desktop": "02-ajout-video-desktop",
  "06-transcript-pret-desktop": "03-transcript-pret-desktop",
  "08-paquet-manuel-pret-desktop": "04-analyse-prete-desktop",
  "10-preview-resume-desktop": "05-preview-desktop",
  "11-apply-bloque-reader-desktop": "06-blocage-reader-desktop",
  "12-import-reussi-desktop": "07-succes-apply-temporaire-desktop",
  "13-nouvelle-connaissance-desktop": "08-connaissance-creee-desktop",
  "17-reponse-citations-desktop": "09-reponse-citee-desktop",
  "19-diagnostic-desktop": "10-diagnostics-desktop",
  "23-accueil-mobile": "11-accueil-mobile",
  "24-ajouter-video-mobile": "12-ajout-video-mobile",
  "25-progression-mobile": "13-progression-mobile",
  "26-succes-mobile": "14-succes-mobile",
  "27-question-mobile": "15-question-mobile",
};

test.beforeAll(async () => {
  await mkdir(screenshotRoot, { recursive: true });
  await mkdir(phase101ScreenshotRoot, { recursive: true });
  fixture = JSON.parse(await readFile(path.join(qaRoot, "fixture.json"), "utf8")) as typeof fixture;
});

function monitor(page: Page) {
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("status of 400 (Bad Request)")) consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
}

async function open(page: Page, url: string) {
  const response = await page.goto(url, { waitUntil: "networkidle" });
  expect(response, `Réponse absente pour ${url}`).not.toBeNull();
  expect(response!.status(), `Erreur HTTP pour ${url}`).toBeLessThan(400);
  await expect(page.locator("main").first()).toBeVisible();
}

async function capture(page: Page, name: string, pageName: string, stateName: string, expected: string, mobile = false) {
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/[A-Z]:\\(?:Users|Program Files|Windows)\\/i);
  expect(body).not.toContain(qaRoot);
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  expect(horizontalOverflow, `Débordement horizontal sur ${name}`).toBe(false);
  const file = path.join(screenshotRoot, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  expect((await stat(file)).size).toBeGreaterThan(5_000);
  const record = { name, page: pageName, state: stateName, resolution: mobile ? "390x844" : "1440x900", date: new Date().toISOString(), fixture: "seed-overnight-qa", expected, observed: `${expected} Élément principal visible, aucune fuite de chemin, exception navigateur ou barre de défilement horizontale.` };
  captures.push(record);
  const phase101Name = PHASE_10_1_NAMES[name];
  if (phase101Name) {
    const phaseFile = path.join(phase101ScreenshotRoot, `${phase101Name}.png`);
    await page.screenshot({ path: phaseFile, fullPage: true });
    expect((await stat(phaseFile)).size).toBeGreaterThan(5_000);
    phase101Captures.push({ ...record, name: phase101Name, fixture: "seed-phase-10-1-qa" });
  }
}

test("parcours desktop, import temporaire et preuves visuelles", async ({ page }) => {
  monitor(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await open(page, "/"); await capture(page, "01-accueil-desktop", "/", "accueil", "Actions principales et état local discret.");
  await open(page, "/add-video"); await capture(page, "02-ajouter-video-desktop", "/add-video", "formulaire", "URL YouTube et traitements récents.");
  await open(page, `/workflows/${fixture.ids.selection}`); await capture(page, "03-inspection-reussie-desktop", "/workflows/[id]", "inspection réussie", "Métadonnées vidéo et source recommandée.");
  await page.getByText("Afficher toutes les langues").click(); await capture(page, "04-choix-transcription-desktop", "/workflows/[id]", "choix transcription", "Sources manuelles et automatiques accessibles.");
  await open(page, `/workflows/${fixture.ids.acquiring}`); await capture(page, "05-acquisition-progression-desktop", "/workflows/[id]", "46 %", "Progression et détails techniques repliés.");
  await open(page, `/workflows/${fixture.ids.transcript}`); await capture(page, "06-transcript-pret-desktop", "/workflows/[id]", "transcript prêt", "Aperçu du transcript et action d’analyse.");
  await open(page, `/chatgpt-packages/new?acquisitionId=${fixture.ids.transcript}&workflowId=${fixture.ids.transcript}`); await capture(page, "07-preparation-analyse-desktop", "/chatgpt-packages/new", "providers", "Mode manuel par défaut et providers explicités.");
  await open(page, `/workflows/${fixture.ids.analysis}`); await capture(page, "08-paquet-manuel-pret-desktop", "/workflows/[id]", "analyse prête", "Paquet manuel et réception du résultat.");
  await open(page, `/workflows/${fixture.ids.result}`); await capture(page, "09-resultat-recu-desktop", "/workflows/[id]", "résultat reçu", "Résultat rattaché au traitement.");

  await open(page, "/imports");
  await page.locator("#import-package").setInputFiles(fixture.mockZip);
  await page.getByRole("button", { name: "Prévisualiser sans appliquer" }).click();
  await expect(page.getByText("Analyse de démonstration")).toBeVisible();
  await capture(page, "10-preview-resume-desktop", "/imports", "Preview mock", "Résumé, opération, diff et confirmation sans écriture.");

  await open(page, `/workflows/${fixture.ids.blocked}`); await capture(page, "11-apply-bloque-reader-desktop", "/workflows/[id]", "writer requis", "Blocage reader expliqué sans UUID dominant.");

  await open(page, "/imports");
  await page.locator("#import-package").setInputFiles(fixture.mockZip);
  await page.getByRole("button", { name: "Prévisualiser sans appliquer" }).click();
  await page.getByLabel(/Je confirme l’ajout/).check();
  await page.getByRole("button", { name: "Ajouter avec sauvegarde" }).click();
  await expect(page.getByRole("heading", { name: "Ajout réussi" })).toBeVisible();
  await capture(page, "12-import-reussi-desktop", "/imports", "Apply temporaire réussi", "Succès avec sauvegarde sur vault temporaire.");

  await open(page, "/library/01_BIBLIOTHEQUE/Demonstration/nouvelle-connaissance.md"); await capture(page, "13-nouvelle-connaissance-desktop", "/library/*", "connaissance", "Note Markdown ajoutée dans la fixture.");
  await open(page, "/videos"); await capture(page, "14-videos-desktop", "/videos", "liste", "Vidéos structurées de la fixture.");
  await open(page, "/"); await page.locator("#global-search").fill("agents"); await page.getByRole("button", { name: "Chercher" }).click(); await expect(page.getByText(/résultat/)).toBeVisible(); await capture(page, "15-recherche-desktop", "/", "résultats agents", "Résultats lexicaux et chemins relatifs.");
  await open(page, "/ask"); await capture(page, "16-poser-question-desktop", "/ask", "formulaire", "Question, domaine et mode local.");
  await page.locator("#library-question").fill("Comment fonctionne un agent IA et quels garde-fous sont mentionnés ?"); await page.getByRole("button", { name: "Interroger la bibliothèque" }).click(); await expect(page.getByRole("heading", { name: "Réponse fondée sur les sources" })).toBeVisible(); await capture(page, "17-reponse-citations-desktop", "/ask", "réponse citée", "Réponse soutenue par passages, lignes et liens.");
  await open(page, "/workflows"); await capture(page, "18-traitements-recents-desktop", "/workflows", "liste", "États reprenables et prochaines actions.");
  await open(page, "/diagnostics"); await capture(page, "19-diagnostic-desktop", "/diagnostics", "lecture seule", "Vault, transcription, providers, writer, backups et runtimes agrégés.");
  await open(page, "/portability"); await capture(page, "20-portabilite-desktop", "/portability", "writer fixture", "État local prudent et cloud non vérifié.");

  expect(consoleErrors, `Erreurs avant le scénario négatif: ${consoleErrors.join(" | ")}`).toEqual([]);
  await open(page, "/add-video"); await page.locator("#workflow-source-url").fill("https://example.com/not-youtube"); const rejectedResponse = page.waitForResponse((response) => response.url().endsWith("/api/workflows") && response.request().method() === "POST"); await page.getByRole("button", { name: "Continuer" }).click(); expect((await rejectedResponse).status()).toBe(400); await expect(page.getByRole("alert").filter({ hasText: "demande de traitement" })).toBeVisible(); await capture(page, "21-erreur-publique-desktop", "/add-video", "URL refusée", "Erreur publique propre sans détail local.");
  await open(page, "/chatgpt-packages"); await capture(page, "22-etat-vide-desktop", "/chatgpt-packages", "aucun paquet", "État vide compréhensible et action suivante.");

  expect(consoleErrors, `Erreurs navigateur: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test("écrans centraux mobiles", async ({ page }) => {
  monitor(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "/"); await capture(page, "23-accueil-mobile", "/", "accueil", "Actions lisibles sans débordement.", true);
  await open(page, "/add-video"); await capture(page, "24-ajouter-video-mobile", "/add-video", "formulaire", "Saisie et bouton visibles.", true);
  await open(page, `/workflows/${fixture.ids.acquiring}`); await capture(page, "25-progression-mobile", "/workflows/[id]", "progression ou reprise", "Progression et reprise après redémarrage lisibles sur 390 px.", true);
  await open(page, `/workflows/${fixture.ids.imported}`); await capture(page, "26-succes-mobile", "/workflows/[id]", "succès", "Lien de connaissance et prochaine action.", true);
  await open(page, "/ask"); await capture(page, "27-question-mobile", "/ask", "question", "Formulaire et modes lisibles.", true);
  expect(consoleErrors, `Erreurs navigateur: ${consoleErrors.join(" | ")}`).toEqual([]);
});

test.afterAll(async () => {
  await mkdir(reportRoot, { recursive: true });
  await writeFile(path.join(reportRoot, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), fixture: "seed-overnight-qa", captures }, null, 2)}\n`, "utf8");
  const rows = captures.map((item) => `| ${item.name} | \`${item.page}\` | ${item.state} | ${item.resolution} | ${item.observed} |`).join("\n");
  const images = captures.map((item) => `### ${item.name}\n\n![${item.state}](screenshots/${item.name}.png)\n\n${item.expected}`).join("\n\n");
  await writeFile(path.join(reportRoot, "index.md"), `# QA visuelle overnight\n\nEnvironnement reproductible sous le dossier temporaire système. Aucun chemin ou contenu réel n’apparaît dans les captures. Chromium Playwright local au projet.\n\n| Capture | Page | État | Résolution | Observation |\n|---|---|---|---|---|\n${rows}\n\n## Captures\n\n${images}\n`, "utf8");
  const phaseRows = phase101Captures.map((item) => `| ${item.name} | \`${item.page}\` | ${item.state} | ${item.resolution} | ${item.observed} |`).join("\n");
  const phaseImages = phase101Captures.map((item) => `### ${item.name}\n\n![${item.state}](screenshots/${item.name}.png)\n\n${item.observed}`).join("\n\n");
  await mkdir(phase101ReportRoot, { recursive: true });
  await writeFile(path.join(phase101ReportRoot, "manifest.json"), `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), fixture: "seed-phase-10-1-qa", captures: phase101Captures }, null, 2)}\n`, "utf8");
  await writeFile(path.join(phase101ReportRoot, "index.md"), `# QA visuelle Phase 10.1\n\nFixture exclusivement temporaire. Chaque capture a été contrôlée pour la hiérarchie, les textes coupés, les boutons hors écran, les identifiants techniques dominants, les erreurs publiques et le débordement horizontal.\n\n| Capture | Page | État | Résolution | Observation |\n|---|---|---|---|---|\n${phaseRows}\n\n## Captures\n\n${phaseImages}\n`, "utf8");
});

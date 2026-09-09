import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { answerLibraryQuestion } from "../src/lib/library-assistant/assistant";
import { RETRIEVAL_BENCHMARK_CASES } from "../src/lib/library-assistant/retrieval-benchmark";

const projectRoot = path.resolve(import.meta.dirname, "..");
const reportPath = path.join(projectRoot, "reports", "retrieval-benchmark.md");

async function configuredVaultPath() {
  const env = await readFile(path.join(projectRoot, ".env.local"), "utf8");
  const entry = env.split(/\r?\n/).find((line) => line.startsWith("YOUTUBE_LIBRARY_PATH="));
  if (!entry) throw new Error("YOUTUBE_LIBRARY_PATH absent de la configuration locale.");
  const value = entry.slice("YOUTUBE_LIBRARY_PATH=".length).trim().replace(/^\"|\"$/g, "");
  if (!value) throw new Error("YOUTUBE_LIBRARY_PATH est vide.");
  return value;
}

async function fingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(current: string): Promise<void> {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "fr"));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || ["node_modules", ".backups"].includes(entry.name)) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".md") {
        hash.update(path.relative(root, target).split(path.sep).join("/")); hash.update(await readFile(target));
      }
    }
  }
  await walk(root); return hash.digest("hex");
}

function linkIsCorrect(relativePath: string, anchor: string | undefined) {
  const href = `/library/${relativePath.split("/").map(encodeURIComponent).join("/")}${anchor ? `#${anchor}` : ""}`;
  return href.startsWith("/library/") && !href.includes("..") && !href.includes("\\");
}

async function run() {
  const sourceVault = await configuredVaultPath();
  if (!(await stat(sourceVault)).isDirectory()) throw new Error("La bibliothèque configurée est inaccessible.");
  const before = await fingerprint(sourceVault);
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tk-retrieval-benchmark-"));
  const fixtureVault = path.join(tempRoot, "vault");
  try {
    // Copie de travail temporaire : aucune lecture du moteur n'utilise le vault réel.
    await cp(sourceVault, fixtureVault, { recursive: true, filter: (entry) => ![".obsidian", ".git", ".backups", ".tubeknowledge", "node_modules"].some((name) => entry.split(path.sep).includes(name)) });
    const rows: string[] = [];
    let passed = 0;
    for (const item of RETRIEVAL_BENCHMARK_CASES) {
      const answer = await answerLibraryQuestion({ question: item.question, provider: "extractive", limit: 12 }, { YOUTUBE_LIBRARY_PATH: fixtureVault });
      const citation = answer.citations.find((candidate) => candidate.relativePath === item.expectedPath);
      const top = answer.citations[0];
      const sourceOk = Boolean(citation);
      // L'ancre est celle du passage réellement classé, donc elle peut différer
      // d'une section attendue voisine tout en restant un lien vérifiable.
      const citationOk = Boolean(citation && citation.lineStart >= 1 && linkIsCorrect(citation.relativePath, citation.anchor));
      const topOk = top?.relativePath === item.expectedPath;
      const indexOk = !item.rejectIndexAsTop || !/(^|\/)INDEX\.md$/.test(top?.relativePath ?? "");
      const multiOk = !item.requireMultipleSources || answer.documentsUsed.length >= 2;
      const ok = sourceOk && citationOk && topOk && indexOk && multiOk;
      if (ok) passed += 1;
      rows.push(`| ${item.id} | ${item.category} | ${ok ? "PASS" : "FAIL"} | ${top?.relativePath ?? "aucune source"} | ${sourceOk ? "oui" : "non"} | ${citationOk ? "oui" : "non"} | ${indexOk ? "oui" : "non"} |`);
    }
    const unchanged = before === await fingerprint(sourceVault);
    const result = passed === RETRIEVAL_BENCHMARK_CASES.length && unchanged ? "PASS" : "FAIL";
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `# Benchmark de récupération\n\nRésultat : **${result}** — ${passed}/${RETRIEVAL_BENCHMARK_CASES.length} cas réussis.\n\nExécution locale sur une copie temporaire de la bibliothèque. Le vault configuré est seulement lu; son empreinte Markdown avant/après est ${unchanged ? "inchangée" : "modifiée (échec)"}. Le rapport n'inclut ni chemin absolu ni extrait de contenu.\n\n| Cas | Couverture | Résultat | Premier résultat relatif | Source attendue | Citation/lien | INDEX non masquant |\n|---|---|---|---|---|---|---|\n${rows.join("\n")}\n\n## Contrôles\n\n- Top résultat : la note attendue doit être classée première.\n- Source : la note attendue doit figurer parmi les citations.\n- Citation/lien : chemin relatif, ligne positive et ancre calculée lorsqu'un passage est sous une section.\n- INDEX : aucune page d'index ne doit masquer une note cible.\n- Multi-source : les deux requêtes transversales exigent au moins deux documents cités.\n`, "utf8");
    if (result !== "PASS") process.exitCode = 1;
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
}

void run();

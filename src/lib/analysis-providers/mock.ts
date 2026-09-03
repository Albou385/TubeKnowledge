import yazl from "yazl";

import { sha256 } from "@/lib/imports/hash";
import { importManifestSchema } from "@/lib/imports/schema";

import { analysisDraftSchema, analysisInputSchema, type AnalysisInput } from "./schema";
import type { AnalysisProvider, AnalysisProviderAvailability, AnalysisProviderResult } from "./types";

const FIXTURE_DATE = new Date("2000-01-01T00:00:00.000Z");

function deterministicUuid(input: AnalysisInput): string {
  const hash = sha256(`${input.freshnessHash}\0${input.metadata.videoId}\0${input.metadata.title}`);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

async function zipFiles(files: Array<{ name: string; content: string }>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const file of files) zip.addBuffer(Buffer.from(file.content, "utf8"), file.name, { mtime: FIXTURE_DATE, mode: 0o100644 });
  zip.end();
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
  });
}

export class MockAnalysisProvider implements AnalysisProvider {
  readonly id = "mock" as const;
  constructor(private readonly now = () => FIXTURE_DATE, private readonly packageId = (input: AnalysisInput) => deterministicUuid(input)) {}

  availability(): AnalysisProviderAvailability {
    return { id: this.id, label: "Démonstration locale", configured: true, automatic: true, reason: "Fixture déterministe sans réseau ni dépense." };
  }

  async run(rawInput: AnalysisInput, options: { signal?: AbortSignal } = {}): Promise<AnalysisProviderResult> {
    const input = analysisInputSchema.parse(rawInput);
    if (options.signal?.aborted) return this.canceled(input);
    const targetPath = "01_BIBLIOTHEQUE/Demonstration/analyse-fixture.md";
    const content = `# Analyse de démonstration\n\n> Fixture locale — aucun fournisseur externe n’a été appelé.\n\n## Sujet\n\n${input.metadata.title}\n\n## Point vérifiable\n\nLe transcript de démonstration contient ${input.transcript.trim().split(/\s+/u).filter(Boolean).length} mots.\n\n## Source\n\nVidéo ${input.metadata.videoId}.\n`;
    const draft = analysisDraftSchema.parse({
      subject: `Démonstration — ${input.metadata.title}`,
      summary: "Résultat de démonstration produit localement pour vérifier le parcours avant toute écriture.",
      claims: [{ statement: "Le résultat provient exclusivement de la fixture locale.", source: "video", citation: "transcript fixture" }],
      proposedFiles: [{ type: "create", path: targetPath, content }],
      warnings: ["Fixture de démonstration — ne pas présenter comme analyse réelle."],
    });
    const contentFile = `changes/create/${targetPath}`;
    const manifest = importManifestSchema.parse({
      schemaVersion: 1,
      packageId: this.packageId(input),
      generatedAt: this.now().toISOString(),
      source: { type: "youtube-video", title: input.metadata.title, url: input.metadata.sourceUrl },
      summary: draft.summary,
      structuralChange: { level: "none", confirmationRequired: false, summary: "Aucune restructuration." },
      operations: [{ type: "create", path: targetPath, contentFile, expectedState: "absent", newSha256: sha256(content) }],
    });
    const importZip = await zipFiles([
      { name: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
      { name: "REVIEW.md", content: `# Revue du résultat mock\n\n${draft.summary}\n\n- ${draft.warnings[0]}\n` },
      { name: contentFile, content },
    ]);
    const completedAt = this.now().toISOString();
    const inputCharacters = input.transcript.length + input.context.reduce((sum, item) => sum + item.content.length, 0);
    return { schemaVersion: 1, provider: this.id, status: "completed", startedAt: completedAt, completedAt, freshnessHash: input.freshnessHash, metrics: { inputCharacters, estimatedInputTokens: Math.ceil(inputCharacters / 4), outputCharacters: content.length }, provenance: { provider: this.id, fixture: true }, draft, importZip };
  }

  private canceled(input: AnalysisInput): AnalysisProviderResult {
    return { schemaVersion: 1, provider: this.id, status: "canceled", startedAt: this.now().toISOString(), freshnessHash: input.freshnessHash, metrics: { inputCharacters: 0, estimatedInputTokens: 0, outputCharacters: 0 }, provenance: { provider: this.id, fixture: true }, publicErrorCode: "ANALYSIS_CANCELED" };
  }
}

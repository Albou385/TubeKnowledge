import { randomUUID } from "node:crypto";
import yazl from "yazl";

import { sha256 } from "@/lib/imports/hash";
import { importManifestSchema } from "@/lib/imports/schema";

import type { AnalysisDraft, AnalysisInput } from "./schema";

const ZIP_TIMESTAMP = new Date("2000-01-01T00:00:00.000Z");

function zipFiles(files: Array<{ name: string; content: string }>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const file of files) zip.addBuffer(Buffer.from(file.content, "utf8"), file.name, { mtime: ZIP_TIMESTAMP, mode: 0o100644 });
  zip.end();
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function analysisDraftToImportZip(input: AnalysisInput, draft: AnalysisDraft, options: { packageId?: string; now?: Date } = {}): Promise<Buffer> {
  const contentFiles: Array<{ name: string; content: string }> = [];
  const operations = draft.proposedFiles.map((proposal) => {
    const contentFile = `changes/${proposal.type}/${proposal.path}`;
    if (proposal.type === "create") {
      if (!input.writeScope.createPrefixes.some((prefix) => proposal.path.startsWith(prefix))) throw new Error("Création hors périmètre.");
      contentFiles.push({ name: contentFile, content: proposal.content });
      return { type: "create" as const, path: proposal.path, contentFile, expectedState: "absent" as const, newSha256: sha256(proposal.content) };
    }
    if (!input.writeScope.replaceFiles.includes(proposal.path)) throw new Error("Remplacement hors périmètre.");
    const context = input.context.find((item) => item.relativePath === proposal.path);
    if (!context) throw new Error("Contexte intégral absent pour le remplacement.");
    contentFiles.push({ name: contentFile, content: proposal.content });
    return { type: "replace" as const, path: proposal.path, contentFile, expectedSha256: context.sha256, newSha256: sha256(proposal.content) };
  });
  const manifest = importManifestSchema.parse({
    schemaVersion: 1,
    packageId: options.packageId ?? randomUUID(),
    generatedAt: (options.now ?? new Date()).toISOString(),
    source: { type: "youtube-video", title: input.metadata.title, url: input.metadata.sourceUrl },
    summary: draft.summary,
    structuralChange: { level: "none", confirmationRequired: false, summary: "Aucune restructuration automatique." },
    operations,
  });
  return zipFiles([
    { name: "manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    { name: "REVIEW.md", content: `# Revue de l’analyse\n\n${draft.summary}\n\n## Avertissements\n\n${draft.warnings.length ? draft.warnings.map((warning) => `- ${warning}`).join("\n") : "- Aucun avertissement fourni."}\n` },
    ...contentFiles,
  ]);
}

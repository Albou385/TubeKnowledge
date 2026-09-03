import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import yazl from "yazl";

import { sha256 } from "@/lib/imports/hash";
import type { ImportManifest } from "@/lib/imports/schema";

export function validManifest(overrides: Partial<ImportManifest> = {}): ImportManifest {
  const content = "# Nouvelle notion\n\nContenu sûr.\n";
  return {
    schemaVersion: 1,
    packageId: "123e4567-e89b-42d3-a456-426614174000",
    generatedAt: "2026-07-21T22:00:00.000Z",
    source: { type: "youtube-video", title: "Vidéo test", url: "https://www.youtube.com/watch?v=test" },
    summary: "Résumé des modifications.",
    structuralChange: { level: "none", confirmationRequired: false, summary: "Aucune restructuration majeure." },
    operations: [{ type: "create", path: "01_BIBLIOTHEQUE/Test/notion.md", contentFile: "changes/create/01_BIBLIOTHEQUE/Test/notion.md", expectedState: "absent", newSha256: sha256(content) }],
    ...overrides,
  };
}

export async function makeZip(files: Array<{ name: string; content: string | Buffer }>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const file of files) zip.addBuffer(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content), file.name);
  zip.end();
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.once("error", reject);
    zip.outputStream.once("end", () => resolve(Buffer.concat(chunks)));
  });
}

export async function packageZip(manifest = validManifest(), root = ""): Promise<Buffer> {
  const prefix = root ? `${root}/` : "";
  const files: Array<{ name: string; content: string }> = [
    { name: `${prefix}manifest.json`, content: JSON.stringify(manifest) },
    { name: `${prefix}REVIEW.md`, content: "# Revue\n\nValider les changements." },
  ];
  for (const operation of manifest.operations) {
    const content = operation.type === "create" ? "# Nouvelle notion\n\nContenu sûr.\n" : "# Remplacé\n\nNouveau contenu.\n";
    files.push({ name: `${prefix}${operation.contentFile}`, content });
  }
  return makeZip(files);
}

export async function makeVault(rootPath: string): Promise<void> {
  await mkdir(rootPath, { recursive: true });
  await writeFile(path.join(rootPath, "INDEX.md"), "# Index\n", "utf8");
}

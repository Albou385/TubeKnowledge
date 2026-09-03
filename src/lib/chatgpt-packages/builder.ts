import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { sha256 } from "@/lib/imports/hash";
import { isAllowedImportTarget } from "@/lib/imports/path-policy";
import type { TranscriptionConfig } from "@/lib/transcription/config";

import { loadPackageAcquisition } from "./acquisition";
import { CHATGPT_PACKAGE_ROOT, SHORT_CHATGPT_INSTRUCTION } from "./constants";
import { loadContextSelection, type ContextSnapshot } from "./context";
import { saveGeneratedPackage, type PackagePreviewRecord, type StoredChatGptPackage } from "./runtime";
import { chatGptPackageManifestSchema, packageRequestSchema, type ChatGptPackageManifest, type PackageRequest } from "./schema";
import { segmentTranscript } from "./segmentation";
import { createStablePackageZip, type PackageFile } from "./zip";

export interface BuildOptions {
  environment?: LibraryEnvironment;
  processEnvironment?: NodeJS.ProcessEnv;
  transcriptionConfig?: TranscriptionConfig;
  runtimeRoot?: string;
  templatesRoot?: string;
  now?: Date;
  packageId?: string;
}

export interface PackagePlan { manifest: ChatGptPackageManifest; preview: PackagePreviewRecord; files: PackageFile[] }

function archiveContextPath(item: ContextSnapshot): string {
  const mappings: Record<string, string> = {
    "00_SYSTEME/PROJECT_INSTRUCTIONS.md": "library/rules/PROJECT_INSTRUCTIONS.md",
    "00_SYSTEME/LIBRARY_RULES.md": "library/rules/LIBRARY_RULES.md",
    "00_SYSTEME/TAXONOMY.md": "library/rules/TAXONOMY.md",
    "INDEX.md": "library/indexes/ROOT_INDEX.md",
    "02_SOURCES/videos.md": "library/sources/videos.md",
    "01_BIBLIOTHEQUE/Intelligence-artificielle/INDEX.md": "library/indexes/INTELLIGENCE_ARTIFICIELLE_INDEX.md",
  };
  return mappings[item.relativePath] ?? `library/context/${item.relativePath}`;
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((result, [key, value]) => result.replaceAll(`{{${key}}}`, value), template);
}

export async function buildPackagePlan(rawRequest: unknown, options: BuildOptions = {}): Promise<PackagePlan> {
  const request: PackageRequest = packageRequestSchema.parse(rawRequest);
  const environment = options.environment ?? process.env;
  const acquisition = await loadPackageAcquisition(request.acquisitionId, options.transcriptionConfig);
  const sourceUrl = acquisition.job.source?.canonicalUrl;
  const videoId = acquisition.job.source?.videoId;
  if (!sourceUrl || !videoId || new URL(sourceUrl).protocol !== "https:") throw new Error("L’acquisition doit posséder une URL YouTube HTTPS canonique et un videoId.");
  const { required, selected } = await loadContextSelection(request.selectedFiles, environment);
  const allContext = [...required, ...selected];
  const snapshot = Object.fromEntries(allContext.map((item) => [item.relativePath, item.sha256]));
  if (request.expectedSnapshot) {
    for (const [relativePath, expected] of Object.entries(request.expectedSnapshot)) if (snapshot[relativePath] !== expected.toLowerCase()) throw new Error(`Le paquet est périmé : ${relativePath} a changé depuis la prévisualisation.`);
  }
  const segmentation = segmentTranscript(acquisition.transcript, acquisition.segments);
  const structuralFiles = request.allowStructuralUpdate ? ["INDEX.md", "00_SYSTEME/TAXONOMY.md"] : [];
  const selectedReplace = selected.map((item) => item.relativePath).filter(isAllowedImportTarget);
  const replaceFiles = [...new Set(["02_SOURCES/videos.md", ...selectedReplace, ...structuralFiles])].sort((a, b) => a.localeCompare(b, "fr"));
  const manifest = chatGptPackageManifestSchema.parse({
    schemaVersion: 1,
    packageId: options.packageId ?? randomUUID(),
    generatedAt: (options.now ?? new Date()).toISOString(),
    acquisitionId: acquisition.job.id,
    source: { type: "youtube-video", videoId, title: acquisition.job.title ?? String(acquisition.metadata.title ?? "Vidéo sans titre"), url: sourceUrl, language: String(acquisition.metadata.language ?? acquisition.job.options?.language ?? "und"), sourceKind: acquisition.job.sourceKind },
    analysis: { language: "fr", technicalTerms: "english-inline", detailLevel: "detailed", focusOnSourceClaims: true, allowExternalContext: true, externalContextMustBeSeparated: true, generateProjectIdeas: false, aiTopicsReceiveExtraDepth: true },
    transcript: { wordCount: acquisition.transcript.trim().split(/\s+/u).filter(Boolean).length, characterCount: acquisition.transcript.length, sha256: sha256(acquisition.transcript), segmented: segmentation.segmented, partCount: segmentation.parts.length, overlapCharacters: segmentation.segmented ? 2_000 : 0 },
    context: { requiredFiles: required.map((item) => item.relativePath), selectedFiles: selected.map((item) => item.relativePath), suggestedFilesRejected: request.suggestedFilesRejected },
    writeScope: { createPrefixes: ["01_BIBLIOTHEQUE/"], replaceFiles, systemFilesAllowed: structuralFiles },
    output: { requiredFormat: "tubeknowledge-import-v1", requiresZip: true, requiresReview: true },
  });
  const templatesRoot = options.templatesRoot ?? path.join(process.cwd(), "templates", "chatgpt");
  const [requestTemplate, uploadTemplate, outputRules, phase3Contract] = await Promise.all([
    readFile(path.join(templatesRoot, "REQUEST_TEMPLATE.md"), "utf8"),
    readFile(path.join(templatesRoot, "UPLOAD_INSTRUCTIONS_TEMPLATE.md"), "utf8"),
    readFile(path.join(templatesRoot, "CHATGPT_OUTPUT_RULES.md"), "utf8"),
    readFile(path.join(process.cwd(), "docs", "IMPORT_PACKAGE_V1.md"), "utf8"),
  ]);
  const requestDocument = renderTemplate(requestTemplate, { PACKAGE_ID: manifest.packageId, SOURCE_TITLE: manifest.source.title, WRITE_SCOPE: manifest.writeScope.replaceFiles.join("\n") });
  const files: PackageFile[] = [
    { path: "package-manifest.json", content: `${JSON.stringify(manifest, null, 2)}\n` },
    { path: "REQUEST.md", content: requestDocument },
    { path: "UPLOAD_INSTRUCTIONS.md", content: renderTemplate(uploadTemplate, { SHORT_INSTRUCTION: SHORT_CHATGPT_INSTRUCTION }) },
    { path: "source/metadata.json", content: `${JSON.stringify(acquisition.metadata, null, 2)}\n` },
    { path: "source/transcript.txt", content: acquisition.transcript },
    ...allContext.map((item) => ({ path: archiveContextPath(item), content: item.content })),
    { path: "scope/selected-context.json", content: `${JSON.stringify({ schemaVersion: 1, required: required.map((item) => item.relativePath), selected: selected.map((item) => item.relativePath), rejectedSuggestions: request.suggestedFilesRejected }, null, 2)}\n` },
    { path: "scope/write-scope.json", content: `${JSON.stringify({ schemaVersion: 1, ...manifest.writeScope }, null, 2)}\n` },
    { path: "contracts/PHASE3_IMPORT_PACKAGE_V1.md", content: phase3Contract },
    { path: "contracts/CHATGPT_OUTPUT_RULES.md", content: outputRules },
  ];
  if (segmentation.segmented) {
    if (acquisition.segmentsDocument) files.push({ path: "source/segments.json", content: acquisition.segmentsDocument });
    files.push({ path: "source/transcript-parts/INDEX.md", content: segmentation.index ?? "" });
    for (const part of segmentation.parts) files.push({ path: `source/transcript-parts/${part.name}`, content: part.content });
  }
  const hashes = {
    transcript: manifest.transcript.sha256,
    transcriptParts: Object.fromEntries(segmentation.parts.map((part) => [part.name, part.sha256])),
    context: Object.fromEntries(allContext.map((item) => [item.relativePath, { sha256: item.sha256, size: item.size, modifiedAt: item.modifiedAt }])),
  };
  files.push({ path: "scope/file-hashes.json", content: `${JSON.stringify(hashes, null, 2)}\n` });
  const uncompressedBytes = files.reduce((total, file) => total + (Buffer.isBuffer(file.content) ? file.content.length : Buffer.byteLength(file.content)), 0);
  const preview: PackagePreviewRecord = { tree: files.map((file) => `${CHATGPT_PACKAGE_ROOT}/${file.path}`).sort((a, b) => a.localeCompare(b, "en")), request: requestDocument, manifest, snapshot, estimates: { words: manifest.transcript.wordCount, characters: manifest.transcript.characterCount, tokenEstimate: Math.ceil(manifest.transcript.characterCount / 4), segments: manifest.transcript.partCount, contexts: allContext.length, uncompressedBytes } };
  return { manifest, preview, files };
}

export async function generatePackage(rawRequest: unknown, options: BuildOptions = {}): Promise<StoredChatGptPackage> {
  const plan = await buildPackagePlan({ ...(rawRequest as Record<string, unknown>), action: "generate" }, options);
  const zip = await createStablePackageZip(plan.files);
  const zipHash = sha256(zip);
  return saveGeneratedPackage({ manifest: plan.manifest, preview: plan.preview, zip, zipSha256: zipHash }, options.runtimeRoot);
}

import { createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import yazl from "yazl";

import { decodeUtf8, sha256 } from "@/lib/imports/hash";
import { importManifestSchema, type ImportManifest } from "@/lib/imports/schema";

export const DEMO_CREATE_PATH = "01_BIBLIOTHEQUE/Tests/phase3-import-demo.md";
export const DEMO_REPLACE_PATH = "02_SOURCES/videos.md";
export const DEMO_ZIP_RELATIVE_PATH = ".tmp/phase3-demo/tubeknowledge-phase3-demo.zip";

const DEMO_CREATE_CONTENT = `# Démonstration de l’import Phase 3

Ce document a été créé par le paquet de démonstration TubeKnowledge.

> Démonstration uniquement : supprimez-le du vault de staging après le test.
`;

const DEMO_VIDEO_ROW = "| Démonstration Phase 3 — ne pas conserver | https://example.invalid/tubeknowledge-phase3-demo | Tests | Démonstration à supprimer |";

export interface DemoPackageResult {
  zipPath: string;
  operations: readonly [typeof DEMO_CREATE_PATH, typeof DEMO_REPLACE_PATH];
  manifest: ImportManifest;
  originalVideosSha256: string;
  newVideosSha256: string;
}

interface GenerateOptions {
  vaultPath: string;
  workingDirectory?: string;
  outputPath?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  now?: Date;
  packageId?: string;
}

function normalizedComparablePath(value: string): string {
  return path.resolve(value).replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase("en-US");
}

function isInside(parent: string, candidate: string): boolean {
  const relation = path.relative(parent, candidate);
  return relation === "" || (!relation.startsWith("..") && !path.isAbsolute(relation));
}

async function readConfiguredVaultPath(
  environment: Readonly<Record<string, string | undefined>>,
  workingDirectory: string,
): Promise<string | null> {
  const configured = environment.YOUTUBE_LIBRARY_PATH?.trim();
  if (configured) return configured;
  try {
    const localEnvironment = await readFile(path.join(workingDirectory, ".env.local"), "utf8");
    const line = localEnvironment.split(/\r?\n/).find((value) => /^\s*YOUTUBE_LIBRARY_PATH\s*=/.test(value));
    if (!line) return null;
    const value = line.slice(line.indexOf("=") + 1).trim();
    return value.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_match, doubleQuoted?: string, singleQuoted?: string) => doubleQuoted ?? singleQuoted ?? "") || null;
  } catch {
    return null;
  }
}

function addZipBuffer(zip: yazl.ZipFile, name: string, content: string): void {
  zip.addBuffer(Buffer.from(content, "utf8"), name);
}

async function writeZip(zip: yazl.ZipFile, outputPath: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 });
    zip.outputStream.once("error", reject);
    output.once("error", reject);
    output.once("close", resolve);
    zip.outputStream.pipe(output);
    zip.end();
  });
  await rm(outputPath, { force: true });
  await rename(temporaryPath, outputPath);
}

export async function generateDemoPackage(options: GenerateOptions): Promise<DemoPackageResult> {
  if (!options.vaultPath?.trim()) throw new Error("Le paramètre --vault est obligatoire.");
  const workingDirectory = path.resolve(options.workingDirectory ?? process.cwd());
  const requestedVault = path.resolve(options.vaultPath);
  const slashVault = requestedVault.replaceAll("\\", "/");
  if (/(?:^|\/)onedrive\/projet_youtube(?:\/|$)/i.test(slashVault)) {
    throw new Error("Le vault réel OneDrive/projet_youtube est interdit. Utilisez un vault de staging.");
  }
  const configuredVault = await readConfiguredVaultPath(options.environment ?? process.env, workingDirectory);
  if (configuredVault && normalizedComparablePath(configuredVault) === normalizedComparablePath(requestedVault)) {
    throw new Error("Le vault configuré par YOUTUBE_LIBRARY_PATH est interdit. Utilisez un vault de staging.");
  }

  const vaultStats = await lstat(requestedVault);
  if (!vaultStats.isDirectory() || vaultStats.isSymbolicLink()) throw new Error("Le vault de staging doit être un dossier réel.");
  const realVault = await realpath(requestedVault);
  const outputPath = path.resolve(options.outputPath ?? path.join(workingDirectory, ...DEMO_ZIP_RELATIVE_PATH.split("/")));
  if (isInside(realVault, outputPath)) throw new Error("Le ZIP de démonstration doit être écrit hors du vault de staging.");

  const videosPath = path.join(realVault, ...DEMO_REPLACE_PATH.split("/"));
  const videosStats = await lstat(videosPath);
  if (!videosStats.isFile() || videosStats.isSymbolicLink()) throw new Error("02_SOURCES/videos.md doit être un fichier réel.");
  const realVideos = await realpath(videosPath);
  if (!isInside(realVault, realVideos)) throw new Error("02_SOURCES/videos.md sort du vault de staging.");

  const createTarget = path.join(realVault, ...DEMO_CREATE_PATH.split("/"));
  try {
    await lstat(createTarget);
    throw new Error(`${DEMO_CREATE_PATH} existe déjà dans le staging.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const originalVideos = decodeUtf8(await readFile(realVideos));
  const separator = originalVideos.length === 0 || originalVideos.endsWith("\n") ? "" : "\n";
  const newVideos = `${originalVideos}${separator}${DEMO_VIDEO_ROW}\n`;
  const manifest = importManifestSchema.parse({
    schemaVersion: 1,
    packageId: options.packageId ?? randomUUID(),
    generatedAt: (options.now ?? new Date()).toISOString(),
    source: {
      type: "manual-notes",
      title: "Paquet de démonstration Phase 3",
      url: "https://example.invalid/tubeknowledge-phase3-demo",
    },
    summary: "Démonstration create + replace pour un vault de staging.",
    structuralChange: {
      level: "none",
      confirmationRequired: false,
      summary: "Aucune restructuration; deux fichiers de démonstration seulement.",
    },
    operations: [
      {
        type: "create",
        path: DEMO_CREATE_PATH,
        contentFile: `changes/create/${DEMO_CREATE_PATH}`,
        expectedState: "absent",
        newSha256: sha256(DEMO_CREATE_CONTENT),
      },
      {
        type: "replace",
        path: DEMO_REPLACE_PATH,
        contentFile: `changes/replace/${DEMO_REPLACE_PATH}`,
        expectedSha256: sha256(originalVideos),
        newSha256: sha256(newVideos),
      },
    ],
  });

  const zip = new yazl.ZipFile();
  addZipBuffer(zip, "manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);
  addZipBuffer(zip, "REVIEW.md", "# Paquet de démonstration Phase 3\n\nVérifiez les deux opérations et leurs différences avant de confirmer Apply. Utilisez uniquement un vault de staging.\n");
  addZipBuffer(zip, `changes/create/${DEMO_CREATE_PATH}`, DEMO_CREATE_CONTENT);
  addZipBuffer(zip, `changes/replace/${DEMO_REPLACE_PATH}`, newVideos);
  await writeZip(zip, outputPath);

  return {
    zipPath: outputPath,
    operations: [DEMO_CREATE_PATH, DEMO_REPLACE_PATH],
    manifest,
    originalVideosSha256: sha256(originalVideos),
    newVideosSha256: sha256(newVideos),
  };
}

export function parseVaultArgument(argumentsList: string[]): string {
  const equalsArgument = argumentsList.find((argument) => argument.startsWith("--vault="));
  if (equalsArgument) return equalsArgument.slice("--vault=".length);
  const index = argumentsList.indexOf("--vault");
  if (index < 0 || !argumentsList[index + 1]) throw new Error('Usage : npm run phase3:demo-package -- --vault "<chemin-du-vault-de-test>"');
  return argumentsList[index + 1];
}

async function main(): Promise<void> {
  const result = await generateDemoPackage({ vaultPath: parseVaultArgument(process.argv.slice(2)) });
  process.stdout.write(`ZIP : ${result.zipPath}\n`);
  process.stdout.write(`Opérations : create ${DEMO_CREATE_PATH}; replace ${DEMO_REPLACE_PATH}\n`);
  process.stdout.write("Vault modifié : non\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Génération impossible."}\n`);
    process.exitCode = 1;
  });
}

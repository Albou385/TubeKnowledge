import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import yauzl, { type Entry, type ZipFile } from "yauzl";
import { z } from "zod";

import { defaultSessionRoot } from "@/lib/imports/sessions";
import { sha256 } from "@/lib/imports/hash";
import { isInsidePath } from "@/lib/transcription/paths";
import { getRuntimeLocation } from "@/lib/transcription/runtime-location";

import type { PortabilityConfig } from "./config";
import { PORTABILITY_LIMITS } from "./constants";
import { atomicWriteBuffer, atomicWriteJson, assertRelativeSafePath } from "./filesystem";
import {
  createMigrationArchive,
  parseMigrationArchive,
  type MigrationCategory,
  type MigrationManifest,
  type MigrationSourceFile,
} from "./migration-archive";

const IMPORT_CONFIRMATION = "REMPLACER RUNTIME";
const MIGRATABLE_RUNTIME_DIRECTORIES = ["video-queue", "video-knowledge-workflows", "acquisitions", "chatgpt-packages", "library-assistant"] as const;
const MIGRATION_TARGET_PLACEHOLDER = "__TUBEKNOWLEDGE_MIGRATION_TARGET__";

const acquisitionJobSchema = z.object({
  id: z.string().uuid(),
  artifacts: z.array(z.object({ name: z.string() }).passthrough()).default([]),
}).passthrough();

const diagnosticFailureSchema = z.object({
  message: z.string(),
  action: z.string(),
}).passthrough();

const importSessionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["ready", "applying", "failed", "applied", "expired"]),
  expiresAt: z.iso.datetime(),
  rootPath: z.string(),
  origin: z.discriminatedUnion("type", [
    z.object({ type: z.literal("chatgpt-package"), packageId: z.string().uuid(), runtimeRoot: z.string().optional() }).passthrough(),
    z.object({ type: z.literal("portability-conflict"), conflictId: z.string().uuid() }).passthrough(),
  ]).optional(),
  failure: diagnosticFailureSchema.optional(),
  result: z.object({
    message: z.string(),
    failure: diagnosticFailureSchema.optional(),
  }).passthrough().optional(),
}).passthrough();

export interface MigrationExportOptions {
  runtimePath?: string;
  sessionPath?: string;
  portabilityConfig?: PortabilityConfig;
  backupId?: string;
  backupZipPath?: string;
  sourceRootHash: string;
  gitCommit: string;
  now?: Date;
}

export interface MigrationImportPreview {
  bundleId: string;
  sourceRootHash: string;
  fileCount: number;
  totalBytes: number;
  categories: Record<MigrationCategory, number>;
  targetEmpty: boolean;
  requiresConfirmation: boolean;
  canImport: boolean;
}

interface ImportTargetFile { relativePath: string; content: Buffer }
interface ImportLocations { runtimePath: string; sessionPath: string; backupPath: string; vaultPath?: string }

const allowedAcquisitionOutputFiles = new Set(["transcript.txt", "transcript.vtt", "segments.json", "metadata.json", "acquisition-report.md"]);

async function regularFile(target: string): Promise<boolean> {
  try {
    const details = await lstat(target);
    if (details.isSymbolicLink()) throw new Error("Lien symbolique interdit dans la migration.");
    return details.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function collectTree(sourceRoot: string, archivePrefix: string, category: MigrationCategory, filter?: (relativePath: string) => boolean): Promise<MigrationSourceFile[]> {
  const files: MigrationSourceFile[] = [];
  async function visit(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
      const target = path.join(directory, entry.name);
      const details = await lstat(target);
      if (details.isSymbolicLink()) throw new Error("Lien symbolique interdit dans le runtime à migrer.");
      if (details.isDirectory()) { await visit(target); continue; }
      if (!details.isFile()) continue;
      const relative = path.relative(sourceRoot, target).split(path.sep).join("/");
      if (filter && !filter(relative)) continue;
      files.push({ path: `${archivePrefix}/${relative}`, content: await readFile(target), category });
    }
  }
  await visit(sourceRoot);
  return files;
}

async function collectAcquisitions(runtimePath: string): Promise<MigrationSourceFile[]> {
  const root = path.join(runtimePath, "acquisitions");
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const files: MigrationSourceFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !z.string().uuid().safeParse(entry.name).success) continue;
    const jobRoot = path.join(root, entry.name);
    const jobPath = path.join(jobRoot, "job.json");
    if (!await regularFile(jobPath)) continue;
    const job = acquisitionJobSchema.parse(JSON.parse(await readFile(jobPath, "utf8")));
    files.push({ path: `runtime/acquisitions/${entry.name}/job.json`, content: await readFile(jobPath), category: "acquisitions" });
    const sourcePath = path.join(jobRoot, "source.json");
    if (await regularFile(sourcePath)) files.push({ path: `runtime/acquisitions/${entry.name}/source.json`, content: await readFile(sourcePath), category: "acquisitions" });
    const artifactNames = new Set(job.artifacts.map((artifact) => artifact.name).filter((name) => allowedAcquisitionOutputFiles.has(name)));
    for (const name of artifactNames) {
      const artifact = path.join(jobRoot, "output", name);
      if (await regularFile(artifact)) files.push({ path: `runtime/acquisitions/${entry.name}/output/${name}`, content: await readFile(artifact), category: "acquisitions" });
    }
    const rawRoot = path.join(jobRoot, "raw");
    files.push(...await collectTree(rawRoot, `runtime/acquisitions/${entry.name}/raw`, "acquisitions", (relative) => /\.(?:txt|md|vtt|srt)$/i.test(relative)));
  }
  return files;
}

async function collectApplySessions(sessionPath: string, now: Date): Promise<MigrationSourceFile[]> {
  let entries;
  try { entries = await readdir(sessionPath, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const files: MigrationSourceFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !/^[0-9a-f-]{36}\.json$/i.test(entry.name)) continue;
    const content = await readFile(path.join(sessionPath, entry.name));
    try {
      const session = importSessionSchema.parse(JSON.parse(content.toString("utf8")));
      if (["ready", "failed", "applied"].includes(session.status) && (session.status === "applied" || new Date(session.expiresAt).getTime() > now.getTime())) {
        const localPaths = [
          session.rootPath,
          session.origin?.type === "chatgpt-package" ? session.origin.runtimeRoot : undefined,
          sessionPath,
        ].filter((value): value is string => Boolean(value));
        const portableSession = {
          ...session,
          rootPath: MIGRATION_TARGET_PLACEHOLDER,
          origin: session.origin?.type === "chatgpt-package"
            ? { ...session.origin, runtimeRoot: MIGRATION_TARGET_PLACEHOLDER }
            : session.origin,
          failure: redactDiagnosticFailure(session.failure, localPaths),
          result: session.result ? {
            ...session.result,
            message: redactLocalPaths(session.result.message, localPaths),
            failure: redactDiagnosticFailure(session.result.failure, localPaths),
          } : undefined,
        };
        files.push({
          path: `apply-sessions/${entry.name}`,
          content: Buffer.from(`${JSON.stringify(portableSession)}\n`, "utf8"),
          category: "apply-sessions",
        });
      }
    } catch { /* Les sessions corrompues ou périmées restent locales pour diagnostic. */ }
  }
  return files;
}

function redactLocalPaths(value: string, localPaths: string[]): string {
  return localPaths
    .flatMap((localPath) => [localPath, localPath.replaceAll("\\", "/"), localPath.replaceAll("/", "\\")])
    .filter((localPath, index, values) => localPath && values.indexOf(localPath) === index)
    .sort((left, right) => right.length - left.length)
    .reduce((redacted, localPath) => {
      const escaped = localPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return redacted.replace(new RegExp(escaped, "gi"), MIGRATION_TARGET_PLACEHOLDER);
    }, value);
}

function redactDiagnosticFailure<T extends { message: string; action: string }>(failure: T | undefined, localPaths: string[]): T | undefined {
  return failure ? {
    ...failure,
    message: redactLocalPaths(failure.message, localPaths),
    action: redactLocalPaths(failure.action, localPaths),
  } : undefined;
}

function assertNoSecretMaterial(files: MigrationSourceFile[]): void {
  const forbidden = [
    /(?:^|\/)\.env(?:\.|$)/i,
    /(?:^|\/)node_modules(?:\/|$)/i,
    /(?:^|\/)\.venv/i,
    /(?:^|\/)models(?:\/|$)/i,
    /(?:^|\/)(?:work|logs|cache|\.cache)(?:\/|$)/i,
    /\.(?:mp3|m4a|wav|webm|opus|part)$/i,
  ];
  for (const file of files) {
    const safe = assertRelativeSafePath(file.path);
    if (forbidden.some((pattern) => pattern.test(safe))) throw new Error(`Contenu interdit dans le bundle : ${safe}`);
  }
}

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY)\s*=/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bgh[oprsu]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
];

function assertTextHasNoSecret(content: Buffer): void {
  const text = content.toString("utf8");
  if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) throw new Error("Le bundle contient un secret potentiel et a été refusé.");
}

function openNestedZip(content: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(content, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => error || !zip ? reject(error ?? new Error("ZIP imbriqué invalide.")) : resolve(zip)));
}

function readNestedEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => {
    if (error || !stream) return reject(error ?? new Error("Entrée ZIP imbriquée illisible."));
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(Buffer.concat(chunks)));
  }));
}

async function assertArchiveHasNoSecret(content: Buffer): Promise<void> {
  const zip = await openNestedZip(content);
  let entries = 0;
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    const fail = (error: unknown) => { zip.close(); reject(error); };
    zip.once("error", fail);
    zip.once("end", resolve);
    zip.on("entry", async (entry: Entry) => {
      try {
        entries += 1;
        total += entry.uncompressedSize;
        if (entries > PORTABILITY_LIMITS.maxBackupEntries || total > PORTABILITY_LIMITS.maxBackupBytes) throw new Error("ZIP imbriqué trop volumineux.");
        if (entry.fileName.endsWith("/")) { zip.readEntry(); return; }
        if (entry.fileName.includes("\\") || entry.fileName.includes("\0") || entry.fileName.startsWith("/") || entry.fileName.split("/").includes("..")) throw new Error("Chemin dangereux dans un ZIP imbriqué.");
        const nested = await readNestedEntry(zip, entry);
        assertTextHasNoSecret(nested);
        zip.readEntry();
      } catch (error) { fail(error); }
    });
    zip.readEntry();
  });
}

async function assertContentsHaveNoSecrets(files: MigrationSourceFile[]): Promise<void> {
  for (const file of files) {
    if (file.path.toLowerCase().endsWith(".zip")) await assertArchiveHasNoSecret(file.content);
    else assertTextHasNoSecret(file.content);
  }
}

export async function exportColdMigrationBundle(options: MigrationExportOptions): Promise<{ archive: Buffer; manifest: MigrationManifest }> {
  const runtimePath = path.normalize(options.runtimePath ?? getRuntimeLocation().runtimePath);
  const sessionPath = path.normalize(options.sessionPath ?? defaultSessionRoot());
  const now = options.now ?? new Date();
  const files: MigrationSourceFile[] = [
    ...await collectTree(path.join(runtimePath, "video-queue"), "runtime/video-queue", "queue", (relative) => relative === "queue-state.json"),
    ...await collectTree(path.join(runtimePath, "video-knowledge-workflows"), "runtime/video-knowledge-workflows", "workflows", (relative) => relative.endsWith(".json")),
    ...await collectAcquisitions(runtimePath),
    ...await collectTree(path.join(runtimePath, "chatgpt-packages"), "runtime/chatgpt-packages", "packages"),
    ...await collectTree(path.join(runtimePath, "library-assistant"), "runtime/library-assistant", "assistant", (relative) => !relative.endsWith(".lock")),
    ...await collectApplySessions(sessionPath, now),
  ];
  if (options.backupId && options.backupZipPath) {
    const backup = await readFile(options.backupZipPath);
    files.push({ path: `portability-backup/${z.string().uuid().parse(options.backupId)}.zip`, content: backup, category: "portability-backup" });
  }
  assertNoSecretMaterial(files);
  await assertContentsHaveNoSecrets(files);
  return createMigrationArchive(files, { sourceRootHash: options.sourceRootHash, gitCommit: options.gitCommit, backupId: options.backupId, now });
}

async function targetHasFiles(target: string): Promise<boolean> {
  try { return (await readdir(target)).length > 0; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}

async function runtimeHasMigratableFiles(runtimePath: string): Promise<boolean> {
  for (const name of MIGRATABLE_RUNTIME_DIRECTORIES) if (await targetHasFiles(path.join(runtimePath, name))) return true;
  return false;
}

function assertImportLocations(options: ImportLocations): ImportLocations {
  const normalized = Object.fromEntries(Object.entries(options).map(([name, target]) => {
    if (!target || !path.isAbsolute(target)) throw new Error(`Le chemin ${name} doit être absolu.`);
    const resolved = path.resolve(target);
    if (resolved === path.parse(resolved).root) throw new Error(`Le chemin ${name} ne peut pas être la racine du volume.`);
    return [name, resolved];
  })) as unknown as ImportLocations;
  const localTargets = [normalized.runtimePath, normalized.sessionPath, normalized.backupPath];
  for (let left = 0; left < localTargets.length; left += 1) {
    for (let right = left + 1; right < localTargets.length; right += 1) {
      if (isInsidePath(localTargets[left], localTargets[right]) || isInsidePath(localTargets[right], localTargets[left])) {
        throw new Error("Les chemins runtime, sessions et backups doivent être distincts et non imbriqués.");
      }
    }
  }
  if (normalized.vaultPath && localTargets.some((target) => isInsidePath(normalized.vaultPath!, target) || isInsidePath(target, normalized.vaultPath!))) {
    throw new Error("Les destinations locales de migration doivent rester hors du vault.");
  }
  return normalized;
}

function targetFiles(files: Map<string, Buffer>, runtimePath: string, sessionPath: string, backupPath: string): ImportTargetFile[] {
  const mapped: ImportTargetFile[] = [];
  for (const [archivePath, content] of files) {
    if (archivePath.startsWith("runtime/")) mapped.push({ relativePath: `runtime/${archivePath.slice("runtime/".length)}`, content });
    else if (archivePath.startsWith("apply-sessions/")) mapped.push({ relativePath: `sessions/${archivePath.slice("apply-sessions/".length)}`, content });
    else if (archivePath.startsWith("portability-backup/")) mapped.push({ relativePath: `backups/${archivePath.slice("portability-backup/".length)}`, content });
    else throw new Error(`Destination de migration inconnue : ${archivePath}`);
  }
  void runtimePath; void sessionPath; void backupPath;
  return mapped;
}

function importCategories(manifest: MigrationManifest): Record<MigrationCategory, number> {
  const values: Record<MigrationCategory, number> = { queue: 0, workflows: 0, acquisitions: 0, packages: 0, assistant: 0, "apply-sessions": 0, "portability-backup": 0, "target-backup": 0 };
  for (const file of manifest.files) values[file.category] += 1;
  return values;
}

export async function previewColdMigrationImport(archive: Buffer, options: { runtimePath: string; sessionPath: string; backupPath: string }): Promise<MigrationImportPreview> {
  const locations = assertImportLocations(options);
  const parsed = await parseMigrationArchive(archive);
  const targetEmpty = !(await runtimeHasMigratableFiles(locations.runtimePath)) && !(await targetHasFiles(locations.sessionPath));
  return {
    bundleId: parsed.manifest.bundleId,
    sourceRootHash: parsed.manifest.sourceRootHash,
    fileCount: parsed.manifest.fileCount,
    totalBytes: parsed.manifest.totalBytes,
    categories: importCategories(parsed.manifest),
    targetEmpty,
    requiresConfirmation: !targetEmpty,
    canImport: targetEmpty,
  };
}

async function createTargetBackup(targets: Array<{ label: string; root: string }>, backupRoot: string, now: Date): Promise<string | null> {
  const existing = [] as MigrationSourceFile[];
  for (const target of targets) existing.push(...await collectTree(target.root, target.label, "target-backup"));
  if (!existing.length) return null;
  const backup = await createMigrationArchive(existing, { sourceRootHash: "0".repeat(64), gitCommit: "0000000", now });
  await mkdir(backupRoot, { recursive: true });
  const target = path.join(backupRoot, `pre-migration-${backup.manifest.bundleId}.zip`);
  await writeFile(target, backup.archive, { flag: "wx", mode: 0o600 });
  if (sha256(await readFile(target)) !== sha256(backup.archive)) throw new Error("Le backup de la cible n’a pas pu être vérifié.");
  return target;
}

async function rewriteSessionForTarget(content: Buffer, vaultPath: string, packagesPath: string): Promise<Buffer> {
  const session = JSON.parse(content.toString("utf8")) as { rootPath?: unknown; origin?: { type?: unknown; runtimeRoot?: unknown } };
  session.rootPath = vaultPath;
  if (session.origin?.type === "chatgpt-package") session.origin.runtimeRoot = packagesPath;
  return Buffer.from(`${JSON.stringify(session)}\n`, "utf8");
}

export async function importColdMigrationBundle(
  archive: Buffer,
  options: { runtimePath: string; sessionPath: string; backupPath: string; vaultPath: string; confirmationText?: string; now?: Date },
): Promise<{ imported: number; idempotent: boolean; targetBackupPath: string | null; bundleId: string }> {
  const locations = assertImportLocations({
    runtimePath: options.runtimePath,
    sessionPath: options.sessionPath,
    backupPath: options.backupPath,
    vaultPath: options.vaultPath,
  });
  const parsed = await parseMigrationArchive(archive);
  const marker = path.join(locations.runtimePath, ".migration-imports", `${parsed.manifest.bundleId}.json`);
  try {
    const record = JSON.parse(await readFile(marker, "utf8")) as { archiveSha256?: string; imported?: number };
    if (record.archiveSha256 !== sha256(archive)) throw new Error("Un autre bundle utilise déjà cet identifiant.");
    return { imported: record.imported ?? parsed.manifest.fileCount, idempotent: true, targetBackupPath: null, bundleId: parsed.manifest.bundleId };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  const targetEmpty = !(await runtimeHasMigratableFiles(locations.runtimePath)) && !(await targetHasFiles(locations.sessionPath));
  if (!targetEmpty && options.confirmationText !== IMPORT_CONFIRMATION) throw new Error(`La cible n’est pas vide. Saisissez exactement ${IMPORT_CONFIRMATION}.`);
  const targetBackupPath = !targetEmpty
    ? await createTargetBackup([
      ...MIGRATABLE_RUNTIME_DIRECTORIES.map((name) => ({ label: `runtime/${name}`, root: path.join(locations.runtimePath, name) })),
      { label: "sessions", root: locations.sessionPath },
    ], locations.backupPath, options.now ?? new Date())
    : null;
  if (!targetEmpty && !targetBackupPath) throw new Error("Un backup vérifié de la cible est requis avant remplacement.");

  const staging = path.join(path.dirname(locations.runtimePath), `.tubeknowledge-migration-${parsed.manifest.bundleId}`);
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: false });
  try {
    const mapped = targetFiles(parsed.files, options.runtimePath, options.sessionPath, options.backupPath);
    for (const file of mapped) {
      const safe = assertRelativeSafePath(file.relativePath);
      const content = safe.startsWith("sessions/")
        ? await rewriteSessionForTarget(file.content, locations.vaultPath!, path.join(locations.runtimePath, "chatgpt-packages"))
        : file.content;
      await atomicWriteBuffer(path.join(staging, ...safe.split("/")), content);
    }
    const stagedRuntime = path.join(staging, "runtime");
    const stagedSessions = path.join(staging, "sessions");
    const stagedBackups = path.join(staging, "backups");
    await mkdir(locations.runtimePath, { recursive: true });
    for (const name of MIGRATABLE_RUNTIME_DIRECTORIES) {
      const stagedDirectory = path.join(stagedRuntime, name);
      if (await targetHasFiles(stagedDirectory)) {
        await rm(path.join(locations.runtimePath, name), { recursive: true, force: true });
        await rename(stagedDirectory, path.join(locations.runtimePath, name));
      }
    }
    if (await targetHasFiles(stagedSessions)) {
      await rm(locations.sessionPath, { recursive: true, force: true });
      await rename(stagedSessions, locations.sessionPath);
    }
    if (await targetHasFiles(stagedBackups)) {
      await mkdir(locations.backupPath, { recursive: true });
      for (const entry of await readdir(stagedBackups)) await rename(path.join(stagedBackups, entry), path.join(locations.backupPath, entry));
    }
    await atomicWriteJson(marker, { schemaVersion: 1, bundleId: parsed.manifest.bundleId, archiveSha256: sha256(archive), imported: parsed.manifest.fileCount, importedAt: (options.now ?? new Date()).toISOString() }, true);
    return { imported: parsed.manifest.fileCount, idempotent: false, targetBackupPath, bundleId: parsed.manifest.bundleId };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export const MIGRATION_IMPORT_CONFIRMATION = IMPORT_CONFIRMATION;

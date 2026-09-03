import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { IMPORT_LIMITS } from "@/lib/imports/constants";
import type { ApplyResult, ImportFailure, ImportSession, StoredOperation } from "@/lib/imports/types";
import type { ImportManifest } from "@/lib/imports/schema";

export function defaultSessionRoot(): string {
  const configured = process.env.TUBEKNOWLEDGE_IMPORT_SESSION_PATH;
  if (!configured) return path.join(os.tmpdir(), "tubeknowledge-import-sessions");
  if (!path.isAbsolute(configured)) throw new Error("TUBEKNOWLEDGE_IMPORT_SESSION_PATH doit être un chemin absolu.");
  const normalized = path.normalize(configured);
  const protectedRoots = [process.env.YOUTUBE_LIBRARY_PATH, process.env.OneDrive, process.env.OneDriveConsumer, process.env.OneDriveCommercial].filter(Boolean) as string[];
  if (protectedRoots.some((root) => {
    const relative = path.relative(path.normalize(root), normalized);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  })) throw new Error("Le stockage des sessions d’import doit rester hors du vault et de OneDrive.");
  return normalized;
}

function sessionPath(root: string, id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Session invalide.");
  return path.join(root, `${id}.json`);
}

function sessionLockPath(root: string, id: string): string {
  return `${sessionPath(root, id)}.apply.lock`;
}

export const PUBLIC_IMPORT_SESSION_ERRORS = {
  SESSION_ABSENT: { message: "Cette vérification est introuvable.", action: "Prévalidez de nouveau le ZIP retourné.", status: 404 },
  SESSION_EXPIRED: { message: "Cette vérification a expiré.", action: "Prévalidez de nouveau le ZIP retourné.", status: 410 },
  SESSION_APPLY_IN_PROGRESS: { message: "Cet ajout est déjà en cours.", action: "Attendez la réponse en cours, puis réessayez si nécessaire.", status: 409 },
  SESSION_REQUIRES_NEW_PREVIEW: { message: "Cette vérification n’est plus applicable.", action: "Prévalidez de nouveau le ZIP retourné.", status: 409 },
  SESSION_INVALID: { message: "Cette vérification locale est invalide.", action: "Prévalidez de nouveau le ZIP retourné.", status: 409 },
} as const;

export type ImportSessionErrorCode = keyof typeof PUBLIC_IMPORT_SESSION_ERRORS;

export class ImportSessionError extends Error {
  constructor(public readonly code: ImportSessionErrorCode) {
    super(PUBLIC_IMPORT_SESSION_ERRORS[code].message);
    this.name = "ImportSessionError";
  }
}

export function publicImportSessionError(error: ImportSessionError) {
  return { code: error.code, message: PUBLIC_IMPORT_SESSION_ERRORS[error.code].message, action: PUBLIC_IMPORT_SESSION_ERRORS[error.code].action };
}

function normalizeSession(value: ImportSession): ImportSession {
  if (value.status) return value;
  const createdAt = value.createdAt;
  return {
    ...value,
    status: value.used ? "failed" : "ready",
    updatedAt: createdAt,
    failure: value.used ? {
      code: "SESSION_REQUIRES_NEW_PREVIEW",
      message: "Cette ancienne session ne contient aucun résultat vérifiable.",
      action: "Prévalidez de nouveau le ZIP retourné.",
      retryable: false,
      requiresNewPreview: true,
      occurredAt: createdAt,
    } : undefined,
  };
}

async function readStoredSession(id: string, sessionRoot: string): Promise<ImportSession> {
  try {
    return normalizeSession(JSON.parse(await readFile(sessionPath(sessionRoot, id), "utf8")) as ImportSession);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ImportSessionError("SESSION_ABSENT");
    if (error instanceof ImportSessionError) throw error;
    throw new ImportSessionError("SESSION_INVALID");
  }
}

async function writeSession(session: ImportSession, sessionRoot: string): Promise<void> {
  const target = sessionPath(sessionRoot, session.id);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(session)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  await rename(temporary, target);
}

export async function createImportSession(input: { rootPath: string; manifest: ImportManifest; operations: StoredOperation[]; origin?: ImportSession["origin"]; review?: string }, sessionRoot = defaultSessionRoot(), now = new Date()): Promise<ImportSession> {
  await mkdir(sessionRoot, { recursive: true });
  const session: ImportSession = {
    id: randomUUID(), createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + IMPORT_LIMITS.sessionTtlMs).toISOString(),
    status: "ready", updatedAt: now.toISOString(), ...input,
  };
  await writeFile(sessionPath(sessionRoot, session.id), JSON.stringify(session), { encoding: "utf8", flag: "wx", mode: 0o600 });
  return session;
}

export async function readImportSession(id: string, sessionRoot = defaultSessionRoot(), now = new Date(), deleteExpired = true): Promise<ImportSession> {
  const session = await readStoredSession(id, sessionRoot);
  if (session.status === "expired" || (session.status !== "applied" && new Date(session.expiresAt).getTime() <= now.getTime())) throw new ImportSessionError("SESSION_EXPIRED");
  if (session.status === "failed" && session.failure?.requiresNewPreview && deleteExpired) throw new ImportSessionError("SESSION_REQUIRES_NEW_PREVIEW");
  return session;
}

export interface ImportSessionClaim {
  session: ImportSession;
  replay?: ApplyResult;
  markFailed: (failure: ImportFailure) => Promise<void>;
  markApplied: (result: ApplyResult) => Promise<void>;
  release: () => Promise<void>;
}

async function acquireSessionLock(id: string, sessionRoot: string, now: Date): Promise<() => Promise<void>> {
  await mkdir(sessionRoot, { recursive: true });
  const target = sessionLockPath(sessionRoot, id);
  const attempt = async () => {
    const handle = await open(target, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ createdAt: now.toISOString() }), "utf8");
    await handle.close();
  };
  try { await attempt(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const age = now.getTime() - (await stat(target)).mtimeMs;
    if (age <= IMPORT_LIMITS.lockStaleMs) throw new ImportSessionError("SESSION_APPLY_IN_PROGRESS");
    await rm(target, { force: true });
    await attempt();
  }
  return () => rm(target, { force: true });
}

export async function claimImportSession(id: string, importId: string, sessionRoot = defaultSessionRoot(), now = new Date()): Promise<ImportSessionClaim> {
  const initial = await readStoredSession(id, sessionRoot);
  if (initial.status === "applied" && initial.result) return { session: initial, replay: initial.result, markFailed: async () => undefined, markApplied: async () => undefined, release: async () => undefined };
  const release = await acquireSessionLock(id, sessionRoot, now);
  try {
    let current = await readStoredSession(id, sessionRoot);
    if (current.status === "applied" && current.result) {
      await release();
      return { session: current, replay: current.result, markFailed: async () => undefined, markApplied: async () => undefined, release: async () => undefined };
    }
    if (current.status === "expired" || new Date(current.expiresAt).getTime() <= now.getTime()) {
      current = { ...current, status: "expired", updatedAt: now.toISOString(), attempt: undefined };
      await writeSession(current, sessionRoot);
      await release();
      throw new ImportSessionError("SESSION_EXPIRED");
    }
    if (current.status === "failed" && (!current.failure?.retryable || current.failure.requiresNewPreview)) {
      await release();
      throw new ImportSessionError("SESSION_REQUIRES_NEW_PREVIEW");
    }
    if (current.status === "applying") {
      const startedAt = current.attempt ? new Date(current.attempt.startedAt).getTime() : now.getTime();
      if (now.getTime() - startedAt <= IMPORT_LIMITS.lockStaleMs) {
        await release();
        throw new ImportSessionError("SESSION_APPLY_IN_PROGRESS");
      }
    }
    current = { ...current, status: "applying", updatedAt: now.toISOString(), attempt: { importId, startedAt: now.toISOString() }, failure: undefined };
    await writeSession(current, sessionRoot);
    let released = false;
    const releaseOnce = async () => { if (!released) { released = true; await release(); } };
    return {
      session: current,
      markFailed: async (failure) => { current = { ...current, status: "failed", updatedAt: failure.occurredAt, failure, attempt: undefined }; await writeSession(current, sessionRoot); },
      markApplied: async (result) => { current = { ...current, status: "applied", updatedAt: now.toISOString(), result, failure: undefined, attempt: undefined }; await writeSession(current, sessionRoot); },
      release: releaseOnce,
    };
  } catch (error) {
    await release().catch(() => undefined);
    throw error;
  }
}

export async function deleteImportSession(id: string, sessionRoot = defaultSessionRoot()): Promise<void> {
  await rm(sessionPath(sessionRoot, id), { force: true });
}

export async function cleanupExpiredSessions(sessionRoot = defaultSessionRoot(), now = new Date()): Promise<void> {
  await mkdir(sessionRoot, { recursive: true });
  for (const name of await readdir(sessionRoot)) {
    if (!name.endsWith(".json")) continue;
    try {
      const session = JSON.parse(await readFile(path.join(sessionRoot, name), "utf8")) as ImportSession;
      if (session.status !== "applied" && new Date(session.expiresAt).getTime() <= now.getTime()) await writeSession({ ...normalizeSession(session), status: "expired", updatedAt: now.toISOString(), attempt: undefined }, sessionRoot);
    } catch { /* Une session illisible est conservée pour diagnostic local et recréation explicite. */ }
  }
}

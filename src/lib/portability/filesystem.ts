import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { isInsidePath } from "@/lib/transcription/paths";

export function toPosixPath(value: string): string { return value.split(path.sep).join("/"); }
export function windowsPathKey(value: string): string { return toPosixPath(value).normalize("NFC").toLocaleLowerCase("en-US"); }

export function assertRelativeSafePath(value: string): string {
  if (!value || value.includes("\\") || path.posix.isAbsolute(value) || /^[a-z]:/i.test(value) || value.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Chemin relatif invalide.");
  return value.normalize("NFC");
}

export async function assertConfinedPath(rootPath: string, relativePath: string, allowMissing = false): Promise<string> {
  const normalized = assertRelativeSafePath(relativePath);
  const root = await realpath(rootPath);
  const target = path.resolve(root, ...normalized.split("/"));
  if (!isInsidePath(root, target)) throw new Error("Chemin hors de la destination autorisée.");
  let current = root;
  for (const part of normalized.split("/")) {
    current = path.join(current, part);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new Error("Lien symbolique ou reparse point interdit.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissing) break;
      throw error;
    }
  }
  return target;
}

export async function atomicWriteBuffer(targetPath: string, content: Uint8Array): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporary = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, targetPath); } catch (error) { await rm(temporary, { force: true }); throw error; }
}

export async function atomicWriteJson(targetPath: string, value: unknown, exclusive = false): Promise<void> {
  const data = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (!exclusive) return atomicWriteBuffer(targetPath, data);
  await mkdir(path.dirname(targetPath), { recursive: true });
  const handle = await open(targetPath, "wx", 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}


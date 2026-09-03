import { open, rename, rm, lstat, realpath, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { isInsideRoot } from "@/lib/library/path-security";

export async function assertSafeTarget(rootPath: string, relativePath: string, allowMissing: boolean): Promise<string> {
  const root = await realpath(rootPath);
  const target = path.resolve(rootPath, ...relativePath.split("/"));
  if (!isInsideRoot(path.resolve(rootPath), target)) throw new Error("Cible hors du vault.");
  let current = path.resolve(rootPath);
  const parts = relativePath.split("/");
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) throw new Error("Lien symbolique interdit dans la cible.");
      if (index < parts.length - 1 && !stats.isDirectory()) throw new Error("Parent de cible invalide.");
      if (index === parts.length - 1) {
        const realTarget = await realpath(current);
        if (!isInsideRoot(root, realTarget)) throw new Error("Cible hors du vault.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && allowMissing) break;
      throw error;
    }
  }
  return target;
}

export async function atomicWrite(targetPath: string, content: string): Promise<void> {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

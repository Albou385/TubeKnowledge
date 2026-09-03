import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { IMPORT_LIMITS } from "@/lib/imports/constants";

export interface ImportLock { path: string; release: () => Promise<void>; }

export async function acquireImportLock(rootPath: string, importId: string, now = new Date()): Promise<ImportLock> {
  const directory = path.join(rootPath, ".tubeknowledge");
  const lockPath = path.join(directory, "import.lock");
  await mkdir(directory, { recursive: true });
  const attempt = async () => {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ importId, createdAt: now.toISOString() }), "utf8");
    await handle.sync();
    await handle.close();
  };
  try { await attempt(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const age = now.getTime() - (await stat(lockPath)).mtimeMs;
    if (age <= IMPORT_LIMITS.lockStaleMs) {
      try { JSON.parse(await readFile(lockPath, "utf8")); } catch { /* an invalid fresh lock still blocks */ }
      throw new Error("Un autre import est déjà en cours.");
    }
    await rm(lockPath, { force: true });
    await attempt();
  }
  return { path: lockPath, release: () => rm(lockPath, { force: true }) };
}

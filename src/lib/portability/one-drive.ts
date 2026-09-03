import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { isInsidePath } from "@/lib/transcription/paths";
import type { PortabilityConfig } from "./config";

export interface OneDriveLocalProbe { probableRoot: string | null; vaultUnderProbableRoot: boolean; indexReadable: boolean; placeholderPaths: string[]; reparsePaths: string[] }
export type AttributeProbe = (target: string) => Promise<{ offline: boolean; unpinned: boolean }>;

export function probeWindowsAttributes(target: string): Promise<{ offline: boolean; unpinned: boolean }> {
  if (process.platform !== "win32") return Promise.resolve({ offline: false, unpinned: false });
  return new Promise((resolve) => execFile("attrib.exe", [target], { windowsHide: true }, (error, stdout) => { if (error) return resolve({ offline: false, unpinned: false }); const flags = stdout.split(target)[0] || ""; resolve({ offline: /O/i.test(flags), unpinned: /U/i.test(flags) }); }));
}

export function probableOneDriveRoots(config: PortabilityConfig, environment: LibraryEnvironment): string[] {
  return [...new Set([config.oneDriveRoot, environment.OneDrive, environment.OneDriveConsumer, environment.OneDriveCommercial].filter(Boolean).map((value) => path.normalize(value!)))];
}

export async function inspectOneDriveLocal(vaultPath: string, config: PortabilityConfig, environment: LibraryEnvironment = process.env, attributeProbe: AttributeProbe = probeWindowsAttributes): Promise<OneDriveLocalProbe> {
  const roots = probableOneDriveRoots(config, environment);
  const probableRoot = roots.find((root) => isInsidePath(root, vaultPath)) || (roots.length === 0 && /onedrive/i.test(vaultPath) ? path.parse(vaultPath).root : null);
  const placeholderPaths: string[] = []; const reparsePaths: string[] = [];
  const indexPath = path.join(vaultPath, "INDEX.md"); let indexReadable = false;
  try {
    const details = await lstat(indexPath);
    if (details.isSymbolicLink()) reparsePaths.push("INDEX.md");
    else { const attributes = await attributeProbe(indexPath); if (attributes.offline || attributes.unpinned) placeholderPaths.push("INDEX.md"); else { await realpath(indexPath); await readFile(indexPath); indexReadable = true; } }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EIO" || code === "EINVAL") placeholderPaths.push("INDEX.md");
  }
  return { probableRoot, vaultUnderProbableRoot: Boolean(probableRoot), indexReadable, placeholderPaths, reparsePaths };
}

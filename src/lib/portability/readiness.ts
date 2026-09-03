import { lstat } from "node:fs/promises";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import type { PortabilityConfig } from "./config";
import { inspectOneDriveLocal } from "./one-drive";
import { readWriterAuthority, isAuthorityActive } from "./writer-authority";
import type { MachineIdentity, ReadinessStatus } from "./types";

export interface PortabilityReadiness { status: ReadinessStatus; localState: "État local stable" | "État local indisponible" | "État local incertain"; cloudState: "Synchronisation cloud non vérifiée"; vaultPresent: boolean; oneDriveProbable: boolean; placeholders: string[]; reparsePoints: string[]; writerMachineId?: string; message: string }

export async function inspectPortabilityReadiness(vaultPath: string, config: PortabilityConfig, identity: MachineIdentity | null, environment: LibraryEnvironment = process.env, now = new Date()): Promise<PortabilityReadiness> {
  const base = { cloudState: "Synchronisation cloud non vérifiée" as const, placeholders: [] as string[], reparsePoints: [] as string[] };
  try { const root = await lstat(vaultPath); if (!root.isDirectory() || root.isSymbolicLink()) throw new Error(); }
  catch { return { ...base, status: "vault-missing", localState: "État local indisponible", vaultPresent: false, oneDriveProbable: false, message: "Le vault n’est pas présent localement." }; }
  const probe = await inspectOneDriveLocal(vaultPath, config, environment);
  if (!probe.vaultUnderProbableRoot) return { ...base, status: "sync-uncertain", localState: "État local incertain", vaultPresent: true, oneDriveProbable: false, message: "La racine OneDrive locale n’est pas reconnue." };
  if (probe.placeholderPaths.length || probe.reparsePaths.length || !probe.indexReadable) return { ...base, status: "offline-placeholder", localState: "État local indisponible", vaultPresent: true, oneDriveProbable: true, placeholders: probe.placeholderPaths, reparsePoints: probe.reparsePaths, message: "Des fichiers requis ne sont pas hydratés localement." };
  const authority = await readWriterAuthority(vaultPath);
  if (authority && isAuthorityActive(authority, now) && identity && authority.machineId !== identity.machineId) return { ...base, status: "writer-active-elsewhere", localState: "État local stable", vaultPresent: true, oneDriveProbable: true, writerMachineId: authority.machineId, message: "Une autre machine possède le rôle writer." };
  return { ...base, status: "ready-local", localState: "État local stable", vaultPresent: true, oneDriveProbable: true, writerMachineId: authority?.machineId, message: "Le vault est lisible et disponible localement; l’état du cloud ne peut pas être certifié." };
}


import os from "node:os";
import path from "node:path";
import { z } from "zod";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { isInsidePath } from "@/lib/transcription/paths";
import { PORTABILITY_LIMITS } from "./constants";
import type { MachineRole } from "./types";

const optionalAbsolute = z.string().trim().optional().transform((value) => value || undefined).refine((value) => !value || path.isAbsolute(value), "Le chemin doit être absolu.");
const schema = z.object({
  TUBEKNOWLEDGE_MACHINE_NAME: z.string().trim().min(1).max(80).optional(),
  TUBEKNOWLEDGE_MACHINE_ROLE: z.enum(["reader", "writer"]).default("reader"),
  TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: optionalAbsolute,
  TUBEKNOWLEDGE_BACKUP_PATH: optionalAbsolute,
  TUBEKNOWLEDGE_ONEDRIVE_ROOT: optionalAbsolute,
  TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: z.coerce.number().int().min(0).max(60).catch(PORTABILITY_LIMITS.defaultStabilityWindowSeconds),
  TUBEKNOWLEDGE_WRITER_LEASE_MINUTES: z.coerce.number().int().min(1).max(1440).catch(PORTABILITY_LIMITS.defaultWriterLeaseMinutes),
  TUBEKNOWLEDGE_BACKUP_RETENTION_COUNT: z.coerce.number().int().min(1).max(1000).catch(PORTABILITY_LIMITS.defaultBackupRetentionCount),
}).passthrough();

export interface PortabilityConfig {
  enabled: boolean; machineName: string; rolePreference: MachineRole; statePath: string; backupPath: string;
  oneDriveRoot?: string; stabilityWindowSeconds: number; writerLeaseMinutes: number; backupRetentionCount: number;
}

function defaultLocalRoot(environment: LibraryEnvironment): string {
  return path.join(environment.LOCALAPPDATA || os.tmpdir(), "TubeKnowledge", "portability");
}

export function getPortabilityConfig(environment: LibraryEnvironment = process.env): PortabilityConfig {
  const value = schema.parse(environment);
  const enabled = Boolean(value.TUBEKNOWLEDGE_PORTABILITY_STATE_PATH);
  const statePath = path.normalize(value.TUBEKNOWLEDGE_PORTABILITY_STATE_PATH || defaultLocalRoot(environment));
  const backupPath = path.normalize(value.TUBEKNOWLEDGE_BACKUP_PATH || path.join(statePath, "backups"));
  const oneDriveRoot = value.TUBEKNOWLEDGE_ONEDRIVE_ROOT ? path.normalize(value.TUBEKNOWLEDGE_ONEDRIVE_ROOT) : undefined;
  for (const [label, localPath] of [["state", statePath], ["backup", backupPath]] as const) {
    if (/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(localPath)) throw new Error(`Le chemin ${label} doit rester hors de OneDrive.`);
    if (environment.YOUTUBE_LIBRARY_PATH && isInsidePath(path.normalize(environment.YOUTUBE_LIBRARY_PATH), localPath)) throw new Error(`Le chemin ${label} doit rester hors du vault.`);
    const roots = [oneDriveRoot, environment.OneDrive, environment.OneDriveConsumer, environment.OneDriveCommercial].filter(Boolean) as string[];
    if (roots.some((root) => isInsidePath(path.normalize(root), localPath))) throw new Error(`Le chemin ${label} doit rester hors de OneDrive.`);
  }
  return { enabled, machineName: value.TUBEKNOWLEDGE_MACHINE_NAME || os.hostname(), rolePreference: value.TUBEKNOWLEDGE_MACHINE_ROLE, statePath, backupPath, oneDriveRoot, stabilityWindowSeconds: value.TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS, writerLeaseMinutes: value.TUBEKNOWLEDGE_WRITER_LEASE_MINUTES, backupRetentionCount: value.TUBEKNOWLEDGE_BACKUP_RETENTION_COUNT };
}

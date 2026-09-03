export type MachineRole = "writer" | "reader";
export type ReadinessStatus = "ready-local" | "sync-uncertain" | "offline-placeholder" | "conflicts-detected" | "vault-missing" | "vault-unreadable" | "writer-active-elsewhere" | "handoff-required" | "backup-required";
export type ConflictType = "content-divergence" | "case-collision" | "duplicate-suspected" | "onedrive-conflict-copy" | "deleted-vs-modified" | "checkpoint-mismatch" | "unexpected-system-change" | "stale-writer-authority" | "incomplete-placeholder";
export type WriterEffectiveState = "uninitialized" | "active-local" | "active-remote" | "expired-local" | "expired-remote" | "handoff-pending-local" | "handoff-pending-remote" | "blocked-by-conflict" | "unavailable";
export type WriterRecommendedAction = "bootstrap" | "renew" | "reacquire" | "examine-conflict" | "wait-for-handoff" | "verify-local" | "configure" | "none";

export interface MachineIdentity { schemaVersion: 1; machineId: string; displayName: string; createdAt: string; rolePreference: MachineRole }
export interface SnapshotFile { path: string; size: number; sha256: string; modifiedAt: string }
export interface VaultSnapshot { schemaVersion: 1; snapshotId: string; createdAt: string; machineId: string; fileCount: number; totalBytes: number; rootHash: string; files: SnapshotFile[] }
export interface Checkpoint { schemaVersion: 1; checkpointId: string; rootHash: string; machineId: string; action: "import" | "restore" | "conflict-resolved" | "handoff" | "backup"; createdAt: string; importId?: string; restoreId?: string; conflictId?: string; backupId?: string }
export interface WriterAuthority { schemaVersion: 1; authorityId: string; machineId: string; displayName: string; grantedAt: string; expiresAt: string; checkpointId: string; status: "active" | "released" }
export interface PortabilityConflict { schemaVersion: 1; conflictId: string; type: ConflictType; detectedAt: string; paths: string[]; baseCheckpointId?: string; severity: "warning" | "blocking"; status: "open" | "resolved" | "false-positive"; evidence: { hashes?: string[]; sizes?: number[]; dates?: string[]; reason: string } }
export interface Handoff { schemaVersion: 1; handoffId: string; sourceMachineId: string; sourceDisplayName: string; targetMachineId?: string; checkpointId: string; rootHash: string; backupId: string; createdAt: string; expiresAt: string; status: "prepared" | "accepted" | "consumed" | "rejected" }
export type BackupProfile = "knowledge" | "full" | "before-write";
export interface BackupFile { path: string; size: number; sha256: string }
export type BackupTrigger = "bootstrap" | "before-write" | "restore" | "manual" | "manual-check" | "unknown";
export interface BackupManifest { schemaVersion: 1; backupId: string; createdAt: string; createdByMachineId: string; profile: BackupProfile; sourceSnapshotId: string; sourceRootHash: string; fileCount: number; totalBytes: number; appVersion: string; gitCommit: string; provenance?: { trigger: BackupTrigger; relatedId?: string }; files: BackupFile[] }
export interface BackupRecord { backupId: string; zipPath: string; zipSha256: string; zipBytes: number; verified: boolean; verifiedAt: string; manifest: BackupManifest; pinned: boolean }
export type RestoreOperationType = "create" | "replace" | "delete-candidate" | "unchanged" | "conflict";
export interface RestoreOperation { type: RestoreOperationType; path: string; currentSha256: string | null; backupSha256: string | null }
export interface RestorePreview { restoreId: string; backupId: string; createdAt: string; expiresAt: string; mode: "restore-to-staging" | "restore-in-place"; operations: RestoreOperation[]; sourceRootHash: string; verified: boolean }


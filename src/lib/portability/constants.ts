export const PORTABILITY_LIMITS = {
  maxSnapshotFiles: 20_000,
  maxBackupBytes: 2 * 1024 * 1024 * 1024,
  maxBackupEntries: 25_000,
  maxFileBytes: 100 * 1024 * 1024,
  defaultStabilityWindowSeconds: 3,
  defaultWriterLeaseMinutes: 30,
  handoffTtlMs: 24 * 60 * 60 * 1000,
  defaultExtendedAbsenceDays: 45,
  minExtendedAbsenceDays: 2,
  maxExtendedAbsenceDays: 60,
  defaultBackupRetentionCount: 10,
  maxDisplayedConflicts: 500,
  writerBootstrapIdempotencyTtlMs: 24 * 60 * 60 * 1000,
  writerBootstrapLockStaleMs: 5 * 60 * 1000,
  writerBootstrapLockWaitMs: 30 * 1000,
  writerOperationIdempotencyTtlMs: 24 * 60 * 60 * 1000,
  sharedWriterTransitionClaimStaleMs: 5 * 60 * 1000,
  sharedWriterTransitionClaimWaitMs: 30 * 1000,
  writerDisasterRecoveryDelayMs: 24 * 60 * 60 * 1000,
  writerDisasterRecoveryPreviewTtlMs: 30 * 60 * 1000,
  defaultRenewalReminderMinutes: 10,
} as const;

export const PORTABILITY_METADATA_PATH = ".tubeknowledge/portability";
export const SNAPSHOT_EXCLUDED_PREFIXES = [
  ".obsidian/", ".tubeknowledge/", ".backups/", "runtime/", "runtimes/", "locks/", "history/", "backups/",
  "state/", "temp/", "tmp/", ".tmp/", "cache/", ".cache/", "staging/", "node_modules/", ".next/", ".git/",
] as const;

export const KNOWLEDGE_BACKUP_ROOTS = ["INDEX.md", "00_SYSTEME/", "01_BIBLIOTHEQUE/", "02_SOURCES/", "03_A_TRAITER/"] as const;


import type { ImportManifest, ImportOperation } from "@/lib/imports/schema";
import type { TextDiff } from "@/lib/imports/diff";

export type ImportStatus = "success" | "rejected" | "conflict" | "rolled-back" | "rollback-failed";
export type ImportSessionStatus = "ready" | "applying" | "failed" | "applied" | "expired";

export interface ImportFailure {
  code: string;
  message: string;
  action: string;
  retryable: boolean;
  requiresNewPreview: boolean;
  occurredAt: string;
  rollbackCompleted?: boolean;
}

export interface ApplyResult {
  status: ImportStatus;
  sessionStatus: ImportSessionStatus;
  importId: string;
  backupId: string | null;
  filesCreated: string[];
  filesReplaced: string[];
  message: string;
  idempotent: boolean;
  failure?: ImportFailure;
}

export interface PreviewOperation {
  type: ImportOperation["type"];
  path: string;
  status: "valid" | "conflict" | "invalid";
  message: string;
  beforeSha256: string | null;
  afterSha256: string;
  diff: TextDiff;
}

export interface ImportPreview {
  sessionId: string;
  expiresAt: string;
  packageId: string;
  source: ImportManifest["source"];
  summary: string;
  structuralChange: ImportManifest["structuralChange"];
  review: string;
  operations: PreviewOperation[];
  canApply: boolean;
  sessionStatus: ImportSessionStatus;
  failure?: ImportFailure;
  appliedResult?: ApplyResult;
}

export interface StoredOperation {
  type: ImportOperation["type"];
  path: string;
  content: string;
  newSha256: string;
  expectedSha256?: string;
  beforeContent: string | null;
  beforeSha256: string | null;
  beforeSize: number | null;
  beforeMtimeMs: number | null;
}

export interface ImportSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  /** Ancien champ V1 conservé uniquement pour relire les sessions existantes. */
  used?: boolean;
  status: ImportSessionStatus;
  updatedAt: string;
  attempt?: { importId: string; startedAt: string };
  failure?: ImportFailure;
  result?: ApplyResult;
  rootPath: string;
  origin?: { type: "chatgpt-package"; packageId: string; runtimeRoot?: string } | { type: "portability-conflict"; conflictId: string };
  manifest: ImportManifest;
  operations: StoredOperation[];
  review?: string;
}

export interface ImportHistoryEntry {
  importId: string;
  packageId: string;
  timestamp: string;
  source: ImportManifest["source"];
  status: ImportStatus;
  structuralChange: ImportManifest["structuralChange"];
  filesCreated: string[];
  filesReplaced: string[];
  conflicts: string[];
  backupId: string | null;
  durationMs: number;
  message: string;
}

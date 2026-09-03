import type { PortabilityReadiness } from "./readiness";
import type { Handoff, MachineIdentity, PortabilityConflict, WriterAuthority, WriterEffectiveState, WriterRecommendedAction } from "./types";
import { isAuthorityActive } from "./writer-authority";
import { isBlockingKnowledgeConflict } from "./conflicts";

export interface EffectiveWriterState {
  state: WriterEffectiveState;
  underlyingState: Exclude<WriterEffectiveState, "blocked-by-conflict">;
  documentPresent: boolean;
  persistentStatus: WriterAuthority["status"] | "absent";
  leaseValid: boolean;
  ownedByLocalMachine: boolean;
  initialized: boolean;
  canWrite: boolean;
  recommendedAction: WriterRecommendedAction;
  blockingReason: string | null;
  expiresAt: string | null;
  leaseRemainingSeconds: number | null;
}

export type WriterWorkflowKind = "bootstrap" | "renew" | "reacquire" | "conflict" | "handoff" | "remote" | "unavailable";

export function writerWorkflowForState(state: WriterEffectiveState): WriterWorkflowKind {
  if (state === "uninitialized") return "bootstrap";
  if (state === "active-local") return "renew";
  if (state === "expired-local") return "reacquire";
  if (state === "blocked-by-conflict") return "conflict";
  if (state === "handoff-pending-local" || state === "handoff-pending-remote") return "handoff";
  if (state === "active-remote" || state === "expired-remote") return "remote";
  return "unavailable";
}

function actionFor(state: Exclude<WriterEffectiveState, "blocked-by-conflict">): WriterRecommendedAction {
  if (state === "uninitialized") return "bootstrap";
  if (state === "active-local") return "renew";
  if (state === "expired-local") return "reacquire";
  if (state === "handoff-pending-local" || state === "handoff-pending-remote" || state === "active-remote" || state === "expired-remote") return "wait-for-handoff";
  if (state === "unavailable") return "verify-local";
  return "none";
}

export function deriveEffectiveWriterState(input: {
  authority: WriterAuthority | null;
  identity: MachineIdentity | null;
  initialized: boolean;
  conflicts: PortabilityConflict[];
  readiness: PortabilityReadiness;
  handoffs?: Handoff[];
  now?: Date;
}): EffectiveWriterState {
  const now = input.now || new Date();
  const authority = input.authority;
  const ownedByLocalMachine = Boolean(authority && input.identity && authority.machineId === input.identity.machineId);
  const leaseValid = Boolean(authority && isAuthorityActive(authority, now));
  const pending = (input.handoffs || []).find((item) => item.status === "prepared" && new Date(item.expiresAt).getTime() > now.getTime());
  let underlyingState: EffectiveWriterState["underlyingState"];

  if (pending) underlyingState = pending.sourceMachineId === input.identity?.machineId ? "handoff-pending-local" : "handoff-pending-remote";
  else if (!input.initialized && !authority) underlyingState = "uninitialized";
  else if (authority?.status === "active" && leaseValid) underlyingState = ownedByLocalMachine ? "active-local" : "active-remote";
  else if (authority?.status === "active" && !leaseValid) underlyingState = ownedByLocalMachine ? "expired-local" : "expired-remote";
  else underlyingState = "unavailable";

  const blockingConflict = input.conflicts.find(isBlockingKnowledgeConflict);
  const locallyAvailable = input.readiness.status === "ready-local";
  const availabilitySensitive = underlyingState === "active-local" || underlyingState === "expired-local" || underlyingState === "unavailable";
  const state = blockingConflict ? "blocked-by-conflict" : (!locallyAvailable && availabilitySensitive ? "unavailable" : underlyingState);
  const canWrite = state === "active-local" && locallyAvailable;
  const expiryMs = authority ? new Date(authority.expiresAt).getTime() : null;
  const leaseRemainingSeconds = expiryMs === null ? null : Math.max(0, Math.floor((expiryMs - now.getTime()) / 1000));

  return {
    state,
    underlyingState,
    documentPresent: Boolean(authority),
    persistentStatus: authority?.status || "absent",
    leaseValid,
    ownedByLocalMachine,
    initialized: input.initialized,
    canWrite,
    recommendedAction: blockingConflict ? "examine-conflict" : actionFor(underlyingState),
    blockingReason: blockingConflict ? `Conflit bloquant ${blockingConflict.type}.` : (!locallyAvailable && underlyingState !== "uninitialized" ? input.readiness.message : null),
    expiresAt: authority?.expiresAt || null,
    leaseRemainingSeconds,
  };
}

import { describe, expect, it } from "vitest";

import type { Handoff, MachineIdentity, PortabilityConflict, WriterAuthority } from "./types";
import type { PortabilityReadiness } from "./readiness";
import { deriveEffectiveWriterState, writerWorkflowForState } from "./writer-state";

const identity: MachineIdentity = { schemaVersion: 1, machineId: "11111111-1111-4111-8111-111111111111", displayName: "Tour", createdAt: "2026-01-01T00:00:00Z", rolePreference: "writer" };
const remoteId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-07-23T12:00:00Z");
const ready: PortabilityReadiness = { status: "ready-local", localState: "État local stable", cloudState: "Synchronisation cloud non vérifiée", vaultPresent: true, oneDriveProbable: true, placeholders: [], reparsePoints: [], message: "Prêt." };
const unavailable: PortabilityReadiness = { ...ready, status: "vault-missing", localState: "État local indisponible", vaultPresent: false, message: "Indisponible." };

function authority(machineId: string, expiresAt: string, status: "active" | "released" = "active"): WriterAuthority {
  return { schemaVersion: 1, authorityId: "33333333-3333-4333-8333-333333333333", machineId, displayName: machineId === identity.machineId ? "Tour" : "Portable", grantedAt: "2026-07-23T11:30:00Z", expiresAt, checkpointId: "44444444-4444-4444-8444-444444444444", status };
}

function handoff(sourceMachineId: string): Handoff {
  return { schemaVersion: 1, handoffId: "55555555-5555-4555-8555-555555555555", sourceMachineId, sourceDisplayName: "Source", checkpointId: "44444444-4444-4444-8444-444444444444", rootHash: "a".repeat(64), backupId: "66666666-6666-4666-8666-666666666666", createdAt: "2026-07-23T11:00:00Z", expiresAt: "2026-07-24T11:00:00Z", status: "prepared" };
}

const blocking: PortabilityConflict = { schemaVersion: 1, conflictId: "77777777-7777-4777-8777-777777777777", type: "checkpoint-mismatch", detectedAt: now.toISOString(), paths: [], severity: "blocking", status: "open", evidence: { reason: "Mismatch" } };
const technical: PortabilityConflict = { ...blocking, conflictId: "88888888-8888-4888-8888-888888888888", type: "stale-writer-authority" };

describe("modèle d’état writer effectif", () => {
  it.each([
    ["uninitialized", null, false, [], []],
    ["active-local", authority(identity.machineId, "2026-07-23T12:30:00Z"), true, [], []],
    ["active-remote", authority(remoteId, "2026-07-23T12:30:00Z"), true, [], []],
    ["expired-local", authority(identity.machineId, "2026-07-23T11:59:00Z"), true, [], []],
    ["expired-remote", authority(remoteId, "2026-07-23T11:59:00Z"), true, [], []],
    ["handoff-pending-local", authority(identity.machineId, "2026-07-23T11:59:00Z", "released"), true, [], [handoff(identity.machineId)]],
    ["handoff-pending-remote", authority(remoteId, "2026-07-23T11:59:00Z", "released"), true, [], [handoff(remoteId)]],
  ] as const)("calcule %s", (expected, writer, initialized, conflicts, handoffs) => {
    expect(deriveEffectiveWriterState({ authority: writer, identity, initialized, conflicts: [...conflicts], readiness: ready, handoffs: [...handoffs], now }).state).toBe(expected);
  });

  it("bloque un conflit de connaissance et conserve l’état sous-jacent", () => {
    expect(deriveEffectiveWriterState({ authority: authority(identity.machineId, "2026-07-23T12:30:00Z"), identity, initialized: true, conflicts: [blocking], readiness: ready, now })).toMatchObject({ state: "blocked-by-conflict", underlyingState: "active-local", canWrite: false, recommendedAction: "examine-conflict" });
  });

  it("traite un ancien conflit writer expiré comme information technique", () => {
    expect(deriveEffectiveWriterState({ authority: authority(identity.machineId, "2026-07-23T11:59:00Z"), identity, initialized: true, conflicts: [technical], readiness: ready, now })).toMatchObject({ state: "expired-local", leaseValid: false, ownedByLocalMachine: true, recommendedAction: "reacquire" });
  });

  it("rend canWrite cohérent et passe à unavailable si le vault ne l’est pas", () => {
    expect(deriveEffectiveWriterState({ authority: authority(identity.machineId, "2026-07-23T12:30:00Z"), identity, initialized: true, conflicts: [], readiness: ready, now }).canWrite).toBe(true);
    expect(deriveEffectiveWriterState({ authority: authority(identity.machineId, "2026-07-23T12:30:00Z"), identity, initialized: true, conflicts: [], readiness: unavailable, now })).toMatchObject({ state: "unavailable", canWrite: false });
  });

  it("sélectionne un seul workflow d’interface par état", () => {
    expect(writerWorkflowForState("uninitialized")).toBe("bootstrap");
    expect(writerWorkflowForState("active-local")).toBe("renew");
    expect(writerWorkflowForState("expired-local")).toBe("reacquire");
    expect(writerWorkflowForState("active-remote")).toBe("remote");
    expect(writerWorkflowForState("blocked-by-conflict")).toBe("conflict");
    expect(writerWorkflowForState("handoff-pending-local")).toBe("handoff");
  });
});

import { describe, expect, it } from "vitest";

import { presentAutomaticRenewal, presentWriterState } from "./overview";

describe("présentation humaine du diagnostic", () => {
  it.each([
    ["expired-local", "reacquire", "Autorisation d’écriture expirée sur cette machine"],
    ["active-local", "renew", "Écriture autorisée sur cette machine"],
    ["expired-remote", "wait-for-handoff", "L’autorisation précédente appartient à l’autre machine et a expiré"],
  ] as const)("traduit %s", (state, action, label) => {
    expect(presentWriterState(state, action)).toMatchObject({ label, action: { href: expect.stringMatching(/^\//) } });
  });

  it.each([
    ["active-local", true, "Renouvellement automatique actif sur la tour"],
    ["expired-local", true, "Autorisation expirée après arrêt prolongé"],
    ["active-remote", true, "Handoff requis pour changer de machine"],
    ["handoff-pending-local", true, "Handoff requis pour changer de machine"],
    ["active-local", false, "Renouvellement automatique désactivé"],
  ] as const)("explique le renouvellement pour %s", (state, enabled, label) => {
    expect(presentAutomaticRenewal(state, enabled)).toMatchObject({ label });
  });
});

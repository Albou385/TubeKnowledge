import { describe, expect, it, vi } from "vitest";

import { createAutomaticWriterRenewalService, runAutomaticWriterRenewal } from "./automatic-writer-renewal";

const now = new Date("2026-07-27T12:00:00Z");
const environment = {};

function status(state: string, options: { enabled?: boolean; canWrite?: boolean; expiresAt?: string | null; reminder?: number } = {}) {
  return {
    operationSettings: { singleMachineMode: options.enabled ?? true, renewalReminderMinutes: options.reminder ?? 10 },
    writer: { state, canWrite: options.canWrite ?? state === "active-local", expiresAt: options.expiresAt ?? "2026-07-27T12:05:00Z" },
  };
}

describe("renouvellement writer automatique", () => {
  it("renouvelle uniquement le writer local valide quand l’échéance approche", async () => {
    const renew = vi.fn().mockResolvedValue(undefined);
    const result = await runAutomaticWriterRenewal(environment, now, {
      status: async () => status("active-local"), renew, leaseMinutes: () => 30,
      idempotencyKey: () => "11111111-1111-4111-8111-111111111111",
    });
    expect(result).toBe("renewed");
    expect(renew).toHaveBeenCalledOnce();
  });

  it.each([
    [status("active-local", { enabled: false }), "disabled"],
    [status("active-remote"), "not-local-writer"],
    [status("expired-local"), "expired"],
    [status("handoff-pending-local"), "handoff-suspended"],
    [status("handoff-pending-remote"), "handoff-suspended"],
    [status("blocked-by-conflict"), "conflict-blocked"],
    [status("active-local", { expiresAt: "2026-07-27T12:20:01Z" }), "not-due"],
  ] as const)("n’écrit pas pour l’état attendu %s", async (value, expected) => {
    const renew = vi.fn();
    await expect(runAutomaticWriterRenewal(environment, now, { status: async () => value, renew, leaseMinutes: () => 30 })).resolves.toBe(expected);
    expect(renew).not.toHaveBeenCalled();
  });

  it("sérialise les cycles, détache le timer du processus et l’arrête proprement", async () => {
    let release!: () => void;
    const check = vi.fn(() => new Promise<"not-due">((resolve) => { release = () => resolve("not-due"); }));
    const unref = vi.fn();
    const clear = vi.fn();
    let callback!: () => void;
    const service = createAutomaticWriterRenewalService({
      check,
      schedule: (scheduled) => { callback = scheduled; return { unref }; },
      clear,
      now: () => now,
    });
    service.start();
    expect(unref).toHaveBeenCalledOnce();
    expect(service.isRunning()).toBe(true);
    callback();
    await expect(service.runNow()).resolves.toBe("already-running");
    release();
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
    service.stop();
    expect(clear).toHaveBeenCalledOnce();
    expect(service.isRunning()).toBe(false);
    await expect(service.runNow()).resolves.toBe("stopped");
  });
});

import { randomUUID } from "node:crypto";

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { getPortabilityConfig } from "./config";
import { getPortabilityStatus } from "./status";
import { renewWriter } from "./writer-operations";

export type AutomaticRenewalOutcome =
  | "disabled"
  | "not-local-writer"
  | "expired"
  | "handoff-suspended"
  | "conflict-blocked"
  | "not-due"
  | "renewed";

interface RenewalStatus {
  operationSettings: { singleMachineMode: boolean; renewalReminderMinutes: number };
  writer: { state: string; canWrite: boolean; expiresAt: string | null };
}

export interface AutomaticRenewalDependencies {
  status?: (environment: LibraryEnvironment, now: Date) => Promise<RenewalStatus>;
  renew?: (idempotencyKey: string, environment: LibraryEnvironment, options: { now: Date }) => Promise<unknown>;
  leaseMinutes?: (environment: LibraryEnvironment) => number;
  idempotencyKey?: () => string;
}

export async function runAutomaticWriterRenewal(
  environment: LibraryEnvironment = process.env,
  now = new Date(),
  dependencies: AutomaticRenewalDependencies = {},
): Promise<AutomaticRenewalOutcome> {
  const status = await (dependencies.status || getPortabilityStatus)(environment, now);
  if (!status.operationSettings.singleMachineMode) return "disabled";
  if (status.writer.state === "blocked-by-conflict") return "conflict-blocked";
  if (status.writer.state === "handoff-pending-local" || status.writer.state === "handoff-pending-remote") return "handoff-suspended";
  if (status.writer.state === "expired-local") return "expired";
  if (status.writer.state !== "active-local" || !status.writer.canWrite || !status.writer.expiresAt) return "not-local-writer";

  const leaseMinutes = (dependencies.leaseMinutes || ((value) => getPortabilityConfig(value).writerLeaseMinutes))(environment);
  const reminderMs = status.operationSettings.renewalReminderMinutes * 60_000;
  const thresholdMs = Math.min(reminderMs, Math.max(30_000, leaseMinutes * 30_000));
  if (new Date(status.writer.expiresAt).getTime() - now.getTime() > thresholdMs) return "not-due";

  await (dependencies.renew || renewWriter)((dependencies.idempotencyKey || randomUUID)(), environment, { now });
  return "renewed";
}

interface RenewalTimer {
  unref?: () => void;
}

export interface AutomaticRenewalServiceOptions {
  environment?: LibraryEnvironment;
  intervalMs?: number;
  now?: () => Date;
  check?: (environment: LibraryEnvironment, now: Date) => Promise<AutomaticRenewalOutcome>;
  schedule?: (callback: () => void, intervalMs: number) => RenewalTimer;
  clear?: (timer: RenewalTimer) => void;
}

export function createAutomaticWriterRenewalService(options: AutomaticRenewalServiceOptions = {}) {
  const environment = options.environment || process.env;
  const now = options.now || (() => new Date());
  const check = options.check || runAutomaticWriterRenewal;
  const schedule = options.schedule || ((callback, intervalMs) => setInterval(callback, intervalMs));
  const clear = options.clear || ((timer) => clearInterval(timer as NodeJS.Timeout));
  let timer: RenewalTimer | null = null;
  let stopped = true;
  let inFlight = false;

  const runNow = async (): Promise<AutomaticRenewalOutcome | "already-running" | "stopped"> => {
    if (stopped) return "stopped";
    if (inFlight) return "already-running";
    inFlight = true;
    try {
      return await check(environment, now());
    } catch {
      return "not-local-writer";
    } finally {
      inFlight = false;
    }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      timer = schedule(() => { void runNow(); }, options.intervalMs || 30_000);
      timer.unref?.();
      void runNow();
    },
    stop() {
      stopped = true;
      if (timer) clear(timer);
      timer = null;
    },
    runNow,
    isRunning: () => !stopped,
  };
}

type AutomaticRenewalService = ReturnType<typeof createAutomaticWriterRenewalService>;
const registry = globalThis as typeof globalThis & { __tubeKnowledgeAutomaticRenewal?: AutomaticRenewalService };

export function startAutomaticWriterRenewal(): AutomaticRenewalService {
  if (registry.__tubeKnowledgeAutomaticRenewal) return registry.__tubeKnowledgeAutomaticRenewal;
  const service = createAutomaticWriterRenewalService();
  registry.__tubeKnowledgeAutomaticRenewal = service;
  process.once("beforeExit", () => {
    service.stop();
    delete registry.__tubeKnowledgeAutomaticRenewal;
  });
  service.start();
  return service;
}

import { randomUUID } from "node:crypto";
import { lstat, open, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { PortabilityConfig } from "./config";
import { removePathWithBoundedRetry } from "./bounded-path-retry";
import { PORTABILITY_LIMITS } from "./constants";
import { PortabilityError } from "./errors";
import { atomicWriteJson } from "./filesystem";
import { ensureLocalProcessInstanceMarker, inspectProcessOwner, processOwnerSchema, type ProcessOwner } from "./process-instance";
import { readVerifiedRegularLeaf, type VerifiedLeafReadOperations } from "./verified-leaf-read";

const uuid = z.string().uuid();
const commonSchema = processOwnerSchema.extend({
  schemaVersion: z.literal(2),
  token: uuid,
  operationId: uuid,
  createdAt: z.iso.datetime(),
});
const choosingSchema = commonSchema.extend({ phase: z.literal("choosing") }).strict();
const ticketSchema = commonSchema.extend({ phase: z.literal("ticket"), ticket: z.number().int().positive() }).strict();
const legacySchema = z.object({ token: uuid, operationId: uuid, createdAt: z.iso.datetime() }).passthrough();
type Choosing = z.infer<typeof choosingSchema>;
type Ticket = z.infer<typeof ticketSchema>;

export interface WriterOperationLockFileOperations extends VerifiedLeafReadOperations {
  readdir: typeof readdir;
  remove: typeof rm;
}

const defaultFileOperations: WriterOperationLockFileOperations = {
  lstat,
  lstatBigInt: (target) => lstat(target, { bigint: true }),
  open,
  readFile: (handle) => handle.readFile("utf8"),
  readdir,
  realpath,
  remove: rm,
  statHandle: (handle) => handle.stat({ bigint: true }),
};

export interface WriterOperationLock {
  release: () => Promise<void>;
}

export function writerOperationLockPath(config: PortabilityConfig): string {
  return path.join(config.statePath, "writer-operation.lock");
}

export function writerOperationLockDirectory(config: PortabilityConfig): string {
  return path.join(config.statePath, "writer-operation-locks");
}

function parseLockFileName(name: string): { phase: "choosing" | "ticket"; token: string } | null {
  const match = /^(.+)\.(choosing|ticket)\.json$/.exec(name);
  if (!match) return null;
  const parsedToken = uuid.safeParse(match[1]);
  if (!parsedToken.success) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: parsedToken.error });
  return { token: parsedToken.data, phase: match[2] as "choosing" | "ticket" };
}

function ownerOf(value: Choosing | Ticket): ProcessOwner {
  return { hostId: value.hostId, processId: value.processId, processInstanceId: value.processInstanceId };
}

async function discardable(value: Choosing | Ticket, modifiedAt: number): Promise<boolean> {
  const state = await inspectProcessOwner(ownerOf(value));
  if (state === "abandoned-local") return true;
  if (state === "active-local") return false;
  return Date.now() - modifiedAt > PORTABILITY_LIMITS.writerBootstrapLockStaleMs;
}

async function removeLockFile(
  target: string,
  expectedToken: string,
  operations: WriterOperationLockFileOperations,
  wait: (milliseconds: number) => Promise<void>,
): Promise<void> {
  await removePathWithBoundedRetry(target, async () => {
    const current = await readVerifiedRegularLeaf(path.dirname(target), target, async () => undefined, wait, operations);
    if (!current) return;
    const token = z.object({ token: uuid }).passthrough().parse(JSON.parse(current.content)).token;
    if (token !== expectedToken) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
  }, { lstat: operations.lstat, remove: operations.remove, wait });
}

async function readClaims(
  directory: string,
  operations: WriterOperationLockFileOperations,
  wait: (milliseconds: number) => Promise<void>,
): Promise<{ choosing: Choosing[]; tickets: Ticket[] }> {
  let names: string[];
  try {
    names = await operations.readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { choosing: [], tickets: [] };
    throw error;
  }
  const choosing: Choosing[] = [];
  const tickets: Ticket[] = [];
  for (const name of names) {
    const fileName = parseLockFileName(name);
    if (!fileName) continue;
    const target = path.join(directory, name);
    try {
      const observed = await readVerifiedRegularLeaf(directory, target, async () => undefined, wait, operations);
      if (!observed) continue;
      const parsed = fileName.phase === "choosing"
        ? choosingSchema.parse(JSON.parse(observed.content))
        : ticketSchema.parse(JSON.parse(observed.content));
      if (parsed.token !== fileName.token || parsed.phase !== fileName.phase) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT");
      if (await discardable(parsed, observed.modifiedAt)) {
        await removeLockFile(target, parsed.token, operations, wait);
        continue;
      }
      if (parsed.phase === "choosing") choosing.push(parsed);
      else tickets.push(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      if (error instanceof PortabilityError) throw error;
      throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: error });
    }
  }
  return { choosing, tickets };
}

async function waitForLegacyLock(
  config: PortabilityConfig,
  startedAt: number,
  wait: (milliseconds: number) => Promise<void>,
  operations: WriterOperationLockFileOperations,
): Promise<void> {
  const target = writerOperationLockPath(config);
  while (true) {
    try {
      const observed = await readVerifiedRegularLeaf(path.dirname(target), target, async () => undefined, wait, operations);
      if (!observed) return;
      const legacy = legacySchema.parse(JSON.parse(observed.content));
      if (Date.now() - observed.modifiedAt > PORTABILITY_LIMITS.writerBootstrapLockStaleMs) {
        await removeLockFile(target, legacy.token, operations, wait);
        return;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      if (error instanceof z.ZodError || error instanceof SyntaxError) throw new PortabilityError("PORTABILITY_STATE_INCONSISTENT", { cause: error });
      throw error;
    }
    if (Date.now() - startedAt >= PORTABILITY_LIMITS.writerBootstrapLockWaitMs) throw new PortabilityError("BOOTSTRAP_IN_PROGRESS");
    await wait(25);
  }
}

function precedes(left: Ticket, right: Ticket): boolean {
  return left.ticket < right.ticket || (left.ticket === right.ticket && left.token.localeCompare(right.token, "en") < 0);
}

export async function acquireWriterOperationLock(
  config: PortabilityConfig,
  operationIdInput: string,
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  fileOperations: Partial<WriterOperationLockFileOperations> = {},
): Promise<WriterOperationLock> {
  const operationId = uuid.parse(operationIdInput);
  const operations = { ...defaultFileOperations, ...fileOperations };
  const startedAt = Date.now();
  await waitForLegacyLock(config, startedAt, wait, operations);
  const processOwner = await ensureLocalProcessInstanceMarker();
  const directory = writerOperationLockDirectory(config);
  const token = randomUUID();
  const common = { schemaVersion: 2 as const, token, operationId, ...processOwner, createdAt: new Date().toISOString() };
  const choosingTarget = path.join(directory, `${token}.choosing.json`);
  const ticketTarget = path.join(directory, `${token}.ticket.json`);
  const cleanup = async () => {
    await Promise.all([removeLockFile(choosingTarget, token, operations, wait), removeLockFile(ticketTarget, token, operations, wait)]);
  };
  try {
    await atomicWriteJson(choosingTarget, choosingSchema.parse({ ...common, phase: "choosing" }));
    const initial = await readClaims(directory, operations, wait);
    const ownTicket = ticketSchema.parse({ ...common, phase: "ticket", ticket: Math.max(0, ...initial.tickets.map((item) => item.ticket)) + 1 });
    await atomicWriteJson(ticketTarget, ownTicket);
    await removeLockFile(choosingTarget, token, operations, wait);
    while (true) {
      const claims = await readClaims(directory, operations, wait);
      if (!claims.choosing.some((item) => item.token !== token)
        && !claims.tickets.some((item) => item.token !== token && precedes(item, ownTicket))) return { release: cleanup };
      if (Date.now() - startedAt >= PORTABILITY_LIMITS.writerBootstrapLockWaitMs) throw new PortabilityError("BOOTSTRAP_IN_PROGRESS");
      await wait(25);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
}

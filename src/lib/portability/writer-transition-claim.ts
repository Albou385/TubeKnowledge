import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { isInsidePath } from "@/lib/transcription/paths";
import { removePathWithBoundedRetry } from "./bounded-path-retry";
import { PORTABILITY_LIMITS, PORTABILITY_METADATA_PATH } from "./constants";
import { PortabilityError } from "./errors";
import { windowsPathKey } from "./filesystem";
import { ensureLocalProcessInstanceMarker, inspectProcessOwner, processOwnerSchema, type ProcessOwner } from "./process-instance";
import { readVerifiedRegularLeaf, type VerifiedLeafReadOperations } from "./verified-leaf-read";

const uuid = z.string().uuid();
const legacyCommonClaimSchema = z.object({
  schemaVersion: z.literal(1),
  token: uuid,
  operationId: uuid,
  machineId: uuid,
  processId: z.number().int().positive(),
  createdAt: z.iso.datetime(),
});
const commonClaimSchema = processOwnerSchema.extend({
  schemaVersion: z.literal(2),
  token: uuid,
  operationId: uuid,
  machineId: uuid,
  createdAt: z.iso.datetime(),
});
const choosingClaimSchema = z.union([
  legacyCommonClaimSchema.extend({ phase: z.literal("choosing") }).strict(),
  commonClaimSchema.extend({ phase: z.literal("choosing") }).strict(),
]);
const ticketClaimSchema = z.union([
  legacyCommonClaimSchema.extend({ phase: z.literal("ticket"), ticket: z.number().int().positive() }).strict(),
  commonClaimSchema.extend({ phase: z.literal("ticket"), ticket: z.number().int().positive() }).strict(),
]);

type ChoosingClaim = z.infer<typeof choosingClaimSchema>;
type TicketClaim = z.infer<typeof ticketClaimSchema>;
type ClaimDirectory = { vaultRoot: string; directory: string; device: number; inode: number };

export interface WriterTransitionClaimFileOperations extends VerifiedLeafReadOperations {
  remove: typeof rm;
}

const defaultFileOperations: WriterTransitionClaimFileOperations = {
  lstat,
  lstatBigInt: (target) => lstat(target, { bigint: true }),
  open,
  readFile: (handle) => handle.readFile("utf8"),
  realpath,
  remove: rm,
  statHandle: (handle) => handle.stat({ bigint: true }),
};

export interface SharedWriterTransitionClaim {
  release(): Promise<void>;
}

export function sharedWriterTransitionClaimPath(vaultPath: string): string {
  return path.join(vaultPath, ...PORTABILITY_METADATA_PATH.split("/"), "writer-transition-claims");
}

function claimPath(directory: string, token: string, phase: "choosing" | "ticket"): string {
  return path.join(directory, `${uuid.parse(token)}.${phase}.json`);
}

function inconsistent(cause?: unknown): PortabilityError {
  return new PortabilityError("PORTABILITY_STATE_INCONSISTENT", cause ? { cause } : undefined);
}

function parseClaimFileName(name: string): { phase: "choosing" | "ticket"; token: string } | null {
  const match = /^(.+)\.(choosing|ticket)\.json$/.exec(name);
  if (!match) return null;
  const parsedToken = uuid.safeParse(match[1]);
  if (!parsedToken.success) throw inconsistent(parsedToken.error);
  return { token: parsedToken.data, phase: match[2] as "choosing" | "ticket" };
}

async function ensureConfinedClaimDirectory(vaultPath: string): Promise<ClaimDirectory> {
  const vaultRoot = await realpath(vaultPath);
  let current = vaultRoot;
  for (const segment of [...PORTABILITY_METADATA_PATH.split("/"), "writer-transition-claims"]) {
    const target = path.join(current, segment);
    try {
      await mkdir(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const details = await lstat(target);
    if (!details.isDirectory() || details.isSymbolicLink()) throw inconsistent();
    const resolved = await realpath(target);
    if (!isInsidePath(vaultRoot, resolved) || windowsPathKey(resolved) !== windowsPathKey(target)) throw inconsistent();
    current = resolved;
  }
  const details = await stat(current);
  return { vaultRoot, directory: current, device: details.dev, inode: details.ino };
}

async function assertClaimDirectoryUnchanged(value: ClaimDirectory): Promise<void> {
  let current = value.vaultRoot;
  for (const segment of [...PORTABILITY_METADATA_PATH.split("/"), "writer-transition-claims"]) {
    const target = path.join(current, segment);
    const details = await lstat(target);
    if (!details.isDirectory() || details.isSymbolicLink()) throw inconsistent();
    const resolved = await realpath(target);
    if (!isInsidePath(value.vaultRoot, resolved) || windowsPathKey(resolved) !== windowsPathKey(target)) throw inconsistent();
    current = resolved;
  }
  const details = await stat(current);
  if (details.dev !== value.device || details.ino !== value.inode || windowsPathKey(current) !== windowsPathKey(value.directory)) throw inconsistent();
}

async function writeClaim(
  value: ClaimDirectory,
  target: string,
  content: unknown,
  operations: WriterTransitionClaimFileOperations,
  wait: (milliseconds: number) => Promise<void>,
): Promise<void> {
  const temporary = path.join(value.directory, `.${path.basename(target)}.${randomUUID()}.tmp`);
  await assertClaimDirectoryUnchanged(value);
  const handle = await open(temporary, "wx", 0o600);
  let confinedTemporary = false;
  let writeFailure: unknown = null;
  try {
    await assertClaimDirectoryUnchanged(value);
    const [pathDetails, handleDetails, resolved] = await Promise.all([lstat(temporary), handle.stat(), realpath(temporary)]);
    if (!pathDetails.isFile()
      || pathDetails.isSymbolicLink()
      || pathDetails.ino !== handleDetails.ino
      || !isInsidePath(value.directory, resolved)) throw inconsistent();
    confinedTemporary = true;
    await handle.writeFile(`${JSON.stringify(content, null, 2)}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    writeFailure = error;
  } finally {
    await handle.close();
  }
  if (writeFailure) {
    if (confinedTemporary) await removeClaim(value, temporary, null, operations, wait).catch(() => undefined);
    throw writeFailure;
  }
  try {
    await assertClaimDirectoryUnchanged(value);
    await rename(temporary, target);
    await assertClaimDirectoryUnchanged(value);
    const details = await lstat(target);
    if (!details.isFile() || details.isSymbolicLink() || !isInsidePath(value.directory, await realpath(target))) throw inconsistent();
  } catch (error) {
    if (confinedTemporary) await removeClaim(value, temporary, null, operations, wait).catch(() => undefined);
    throw error;
  }
}

async function removeClaim(
  value: ClaimDirectory,
  target: string,
  expectedToken: string | null,
  operations: WriterTransitionClaimFileOperations,
  wait: (milliseconds: number) => Promise<void>,
): Promise<void> {
  await removePathWithBoundedRetry(target, async () => {
    await assertClaimDirectoryUnchanged(value);
    const details = await lstat(target);
    if (!details.isFile() || details.isSymbolicLink() || !isInsidePath(value.directory, await realpath(target))) throw inconsistent();
    if (expectedToken) {
      const current = await readVerifiedRegularLeaf(value.directory, target, () => assertClaimDirectoryUnchanged(value), wait, operations);
      if (!current) return;
      const token = z.object({ token: uuid }).passthrough().parse(JSON.parse(current.content)).token;
      if (token !== expectedToken) throw inconsistent();
    }
  }, { lstat: operations.lstat, remove: operations.remove, wait });
  await assertClaimDirectoryUnchanged(value);
}

function ownerOf(claim: ChoosingClaim | TicketClaim): ProcessOwner | null {
  return claim.schemaVersion === 2
    ? { hostId: claim.hostId, processId: claim.processId, processInstanceId: claim.processInstanceId }
    : null;
}

async function discardable(claim: ChoosingClaim | TicketClaim, modifiedAt: number, now: number): Promise<boolean> {
  const owner = ownerOf(claim);
  if (!owner) return now - modifiedAt > PORTABILITY_LIMITS.sharedWriterTransitionClaimStaleMs;
  const state = await inspectProcessOwner(owner, now);
  if (state === "abandoned-local") return true;
  if (state === "active-local") return false;
  return now - modifiedAt > PORTABILITY_LIMITS.sharedWriterTransitionClaimStaleMs;
}

async function readActiveClaims(
  value: ClaimDirectory,
  operations: WriterTransitionClaimFileOperations,
  wait: (milliseconds: number) => Promise<void>,
): Promise<{ choosing: ChoosingClaim[]; tickets: TicketClaim[] }> {
  await assertClaimDirectoryUnchanged(value);
  const names = await readdir(value.directory);
  const choosing: ChoosingClaim[] = [];
  const tickets: TicketClaim[] = [];
  for (const name of names) {
    const fileName = parseClaimFileName(name);
    if (!fileName) continue;
    const target = path.join(value.directory, name);
    try {
      const observed = await readVerifiedRegularLeaf(value.directory, target, () => assertClaimDirectoryUnchanged(value), wait, operations);
      if (!observed) continue;
      const parsed = fileName.phase === "choosing"
        ? choosingClaimSchema.parse(JSON.parse(observed.content))
        : ticketClaimSchema.parse(JSON.parse(observed.content));
      if (parsed.token !== fileName.token || parsed.phase !== fileName.phase) throw inconsistent();
      if (await discardable(parsed, observed.modifiedAt, Date.now())) {
        await removeClaim(value, target, parsed.token, operations, wait);
        continue;
      }
      if (parsed.phase === "choosing") choosing.push(parsed);
      else tickets.push(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      if (error instanceof PortabilityError) throw error;
      throw inconsistent(error);
    }
  }
  return { choosing, tickets };
}

function precedes(left: TicketClaim, right: TicketClaim): boolean {
  return left.ticket < right.ticket || (left.ticket === right.ticket && left.token.localeCompare(right.token, "en") < 0);
}

export async function acquireSharedWriterTransitionClaim(
  vaultPath: string,
  operationIdInput: string,
  machineIdInput: string,
  wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  fileOperations: Partial<WriterTransitionClaimFileOperations> = {},
): Promise<SharedWriterTransitionClaim> {
  const operationId = uuid.parse(operationIdInput);
  const machineId = uuid.parse(machineIdInput);
  const operations = { ...defaultFileOperations, ...fileOperations };
  const directory = await ensureConfinedClaimDirectory(vaultPath);
  const processOwner = await ensureLocalProcessInstanceMarker();
  const token = randomUUID();
  const common = { schemaVersion: 2 as const, token, operationId, machineId, ...processOwner, createdAt: new Date().toISOString() };
  const choosingTarget = claimPath(directory.directory, token, "choosing");
  const ticketTarget = claimPath(directory.directory, token, "ticket");
  const cleanup = async () => {
    await Promise.all([
      removeClaim(directory, choosingTarget, token, operations, wait),
      removeClaim(directory, ticketTarget, token, operations, wait),
    ]);
  };
  const startedAt = Date.now();
  try {
    await writeClaim(directory, choosingTarget, { ...common, phase: "choosing" }, operations, wait);
    const initial = await readActiveClaims(directory, operations, wait);
    const ownTicket = ticketClaimSchema.parse({
      ...common,
      phase: "ticket",
      ticket: Math.max(0, ...initial.tickets.map((claim) => claim.ticket)) + 1,
    });
    await writeClaim(directory, ticketTarget, ownTicket, operations, wait);
    await removeClaim(directory, choosingTarget, token, operations, wait);

    while (true) {
      const claims = await readActiveClaims(directory, operations, wait);
      const anotherIsChoosing = claims.choosing.some((claim) => claim.token !== token);
      const precedingTicket = claims.tickets.some((claim) => claim.token !== token && precedes(claim, ownTicket));
      if (!anotherIsChoosing && !precedingTicket) return { release: cleanup };
      if (Date.now() - startedAt >= PORTABILITY_LIMITS.sharedWriterTransitionClaimWaitMs) throw new PortabilityError("WRITER_TRANSITION_IN_PROGRESS");
      await wait(25);
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
}

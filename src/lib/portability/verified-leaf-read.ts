import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, type FileHandle } from "node:fs/promises";
import path from "node:path";

import { boundedPathRetryAttempts, boundedPathRetryDelayMs, readPathWithBoundedRetry } from "./bounded-path-retry";
import { windowsPathKey } from "./filesystem";
import { PortabilityError } from "./errors";

export interface VerifiedLeafReadOperations {
  lstat: typeof lstat;
  lstatBigInt: (target: string) => Promise<BigIntStats>;
  open: typeof open;
  readFile: (handle: FileHandle, target: string) => Promise<string>;
  realpath: typeof realpath;
  statHandle: (handle: FileHandle) => Promise<BigIntStats>;
}

export interface VerifiedLeafReadResult {
  content: string;
  modifiedAt: number;
}

const defaultOperations: VerifiedLeafReadOperations = {
  lstat,
  lstatBigInt: (target) => lstat(target, { bigint: true }),
  open,
  readFile: (handle) => handle.readFile("utf8"),
  realpath,
  statHandle: (handle) => handle.stat({ bigint: true }),
};

class LeafCycleInvalidated extends Error {
  constructor(cause?: unknown) {
    super("Verified leaf changed during the read cycle.", cause ? { cause } : undefined);
    this.name = "LeafCycleInvalidated";
  }
}

function inconsistent(cause?: unknown): PortabilityError {
  return new PortabilityError("PORTABILITY_STATE_INCONSISTENT", cause ? { cause } : undefined);
}

function assertRegularLeaf(details: Pick<Awaited<ReturnType<typeof lstat>>, "isFile" | "isSymbolicLink">): void {
  if (!details.isFile() || details.isSymbolicLink()) throw inconsistent();
}

function assertUsableIdentity(...details: BigIntStats[]): void {
  if (details.some((item) => item.ino.toString() === "0" || item.ino.toString().startsWith("-"))) throw inconsistent();
}

function sameInode(...details: BigIntStats[]): boolean {
  const inode = details[0]?.ino;
  return inode !== undefined && details.every((item) => item.ino === inode);
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function directlyInside(directory: string, resolvedTarget: string): boolean {
  return windowsPathKey(path.dirname(resolvedTarget)) === windowsPathKey(directory);
}

function transientFilesystemError(error: unknown): boolean {
  return ["ENOENT", "EPERM", "EBUSY"].includes((error as NodeJS.ErrnoException).code || "");
}

interface OpenLeafSnapshot {
  handleIdentity: BigIntStats;
  pathIdentity: BigIntStats;
  resolvedDirectory: string;
  resolvedTarget: string;
}

async function captureOpenLeafSnapshot(
  directory: string,
  target: string,
  handle: FileHandle,
  validateContainer: () => Promise<void>,
  operations: VerifiedLeafReadOperations,
): Promise<OpenLeafSnapshot> {
  let snapshot: OpenLeafSnapshot & { pathDetails: Awaited<ReturnType<typeof lstat>> };
  try {
    const [handleIdentity, pathDetails, pathIdentity, resolvedDirectory, resolvedTarget] = await Promise.all([
      operations.statHandle(handle),
      operations.lstat(target),
      operations.lstatBigInt(target),
      operations.realpath(directory),
      operations.realpath(target),
    ]);
    snapshot = { handleIdentity, pathDetails, pathIdentity, resolvedDirectory, resolvedTarget };
  } catch (error) {
    if (transientFilesystemError(error)) throw new LeafCycleInvalidated(error);
    throw error;
  }
  await validateContainer();
  assertRegularLeaf(snapshot.handleIdentity);
  assertRegularLeaf(snapshot.pathDetails);
  assertRegularLeaf(snapshot.pathIdentity);
  assertUsableIdentity(snapshot.handleIdentity, snapshot.pathIdentity);
  if (!directlyInside(snapshot.resolvedDirectory, snapshot.resolvedTarget)) throw new LeafCycleInvalidated();
  return snapshot;
}

export async function readVerifiedRegularLeaf(
  directory: string,
  target: string,
  validateContainer: () => Promise<void>,
  wait: (milliseconds: number) => Promise<void>,
  fileOperations: Partial<VerifiedLeafReadOperations> = {},
): Promise<VerifiedLeafReadResult | null> {
  const operations = { ...defaultOperations, ...fileOperations };
  if (windowsPathKey(path.dirname(target)) !== windowsPathKey(directory)) throw inconsistent();

  for (let cycle = 1; cycle <= boundedPathRetryAttempts; cycle += 1) {
    try {
      return await readPathWithBoundedRetry(target, async () => {
        await validateContainer();
        const before = await operations.lstat(target);
        assertRegularLeaf(before);
        const [beforeIdentity, resolvedDirectoryBefore, resolvedTargetBefore] = await Promise.all([
          operations.lstatBigInt(target),
          operations.realpath(directory),
          operations.realpath(target),
        ]);
        assertRegularLeaf(beforeIdentity);
        assertUsableIdentity(beforeIdentity);
        if (!directlyInside(resolvedDirectoryBefore, resolvedTargetBefore)) throw new LeafCycleInvalidated();

        const handle = await operations.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const beforeRead = await captureOpenLeafSnapshot(directory, target, handle, validateContainer, operations);
          if (!sameInode(beforeIdentity, beforeRead.handleIdentity, beforeRead.pathIdentity)
            || !sameIdentity(beforeIdentity, beforeRead.pathIdentity)
            || windowsPathKey(beforeRead.resolvedDirectory) !== windowsPathKey(resolvedDirectoryBefore)
            || windowsPathKey(beforeRead.resolvedTarget) !== windowsPathKey(resolvedTargetBefore)) throw new LeafCycleInvalidated();

          const content = await operations.readFile(handle, target);
          const afterRead = await captureOpenLeafSnapshot(directory, target, handle, validateContainer, operations);
          if (!sameInode(beforeIdentity, beforeRead.handleIdentity, afterRead.handleIdentity, afterRead.pathIdentity)
            || !sameIdentity(beforeIdentity, afterRead.pathIdentity)
            || !sameIdentity(beforeRead.handleIdentity, afterRead.handleIdentity)
            || windowsPathKey(afterRead.resolvedDirectory) !== windowsPathKey(beforeRead.resolvedDirectory)
            || windowsPathKey(afterRead.resolvedTarget) !== windowsPathKey(beforeRead.resolvedTarget)) throw new LeafCycleInvalidated();
          return { content, modifiedAt: before.mtimeMs };
        } finally {
          await handle.close();
        }
      }, { lstat: operations.lstat, wait });
    } catch (error) {
      if (!(error instanceof LeafCycleInvalidated)) throw error;
      if (cycle === boundedPathRetryAttempts) throw inconsistent(error);
      await wait(boundedPathRetryDelayMs);
    }
  }
  throw inconsistent();
}

import { lstat, rm } from "node:fs/promises";

const retryableCodes = new Set(["ENOENT", "EPERM", "EBUSY"]);
export const boundedPathRetryAttempts = 4;
export const boundedPathRetryDelayMs = 5;

export interface BoundedPathRetryOptions {
  lstat?: typeof lstat;
  remove?: typeof rm;
  wait?: (milliseconds: number) => Promise<void>;
}

function retryable(error: unknown): boolean {
  return retryableCodes.has((error as NodeJS.ErrnoException).code || "");
}

async function confirmedMissing(target: string, probe: typeof lstat): Promise<boolean> {
  try {
    await probe(target);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

export async function readPathWithBoundedRetry<T>(
  target: string,
  operation: () => Promise<T>,
  options: BoundedPathRetryOptions = {},
): Promise<T | null> {
  const probe = options.lstat || lstat;
  const wait = options.wait || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= boundedPathRetryAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!retryable(error)) throw error;
      lastError = error;
      try {
        if (await confirmedMissing(target, probe)) return null;
      } catch (probeError) {
        if (!retryable(probeError)) throw probeError;
        lastError = probeError;
      }
      if (attempt < boundedPathRetryAttempts) await wait(boundedPathRetryDelayMs);
    }
  }
  throw lastError;
}

export async function removePathWithBoundedRetry(
  target: string,
  revalidate: () => Promise<void>,
  options: BoundedPathRetryOptions = {},
): Promise<void> {
  const probe = options.lstat || lstat;
  const remove = options.remove || rm;
  const wait = options.wait || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown = Object.assign(new Error("Path removal was not confirmed."), { code: "EBUSY" });
  for (let attempt = 1; attempt <= boundedPathRetryAttempts; attempt += 1) {
    try {
      await revalidate();
      await remove(target);
      if (await confirmedMissing(target, probe)) return;
      lastError = Object.assign(new Error("Path removal was not confirmed."), { code: "EBUSY" });
    } catch (error) {
      if (!retryable(error)) throw error;
      lastError = error;
      try {
        if (await confirmedMissing(target, probe)) return;
      } catch (probeError) {
        if (!retryable(probeError)) throw probeError;
        lastError = probeError;
      }
    }
    if (attempt < boundedPathRetryAttempts) await wait(boundedPathRetryDelayMs);
  }
  throw lastError;
}

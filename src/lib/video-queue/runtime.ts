import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { getRuntimeLocation } from "@/lib/transcription/runtime-location";

import { VideoQueueError } from "./errors";
import { videoQueueStoreSchema, type VideoQueueStore } from "./schema";

export const VIDEO_QUEUE_HISTORY_LIMIT = 500;
export const VIDEO_QUEUE_COMMAND_LIMIT = 200;
const LOCK_STALE_MS = 5 * 60_000;
const LOCK_WAIT_MS = 2_000;

export function videoQueueRuntimePath(environment: NodeJS.ProcessEnv = process.env): string {
  return path.join(getRuntimeLocation(environment).runtimePath, "video-queue");
}

export function emptyVideoQueueStore(): VideoQueueStore {
  return { schemaVersion: 1, revision: 0, paused: false, activeItemId: null, items: [], history: [], commands: [] };
}

export function hashQueueRequest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function statePath(root: string): string { return path.join(root, "queue-state.json"); }
function lockPath(root: string): string { return path.join(root, "queue-state.lock"); }

export async function loadVideoQueueStore(root = videoQueueRuntimePath()): Promise<VideoQueueStore> {
  try {
    return videoQueueStoreSchema.parse(JSON.parse(await readFile(statePath(root), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyVideoQueueStore();
    throw new VideoQueueError("QUEUE_STATE_CORRUPT", { cause: error });
  }
}

export async function saveVideoQueueStore(store: VideoQueueStore, root = videoQueueRuntimePath()): Promise<VideoQueueStore> {
  const valid = videoQueueStoreSchema.parse({ ...store, revision: store.revision + 1 });
  await mkdir(root, { recursive: true });
  const target = statePath(root);
  const temporary = path.join(root, `.queue-state.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(valid, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  try { await rename(temporary, target); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
  return valid;
}

export interface VideoQueueLock { release: () => Promise<void> }

export async function acquireVideoQueueLock(
  root = videoQueueRuntimePath(),
  options: { now?: () => Date; wait?: (milliseconds: number) => Promise<void> } = {},
): Promise<VideoQueueLock> {
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  await mkdir(root, { recursive: true });
  const target = lockPath(root);
  const token = randomUUID();
  const startedAt = now().getTime();
  while (true) {
    try {
      const handle = await open(target, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ token, createdAt: now().toISOString() }), "utf8");
      await handle.sync();
      await handle.close();
      return {
        release: async () => {
          try {
            const current = JSON.parse(await readFile(target, "utf8")) as { token?: string };
            if (current.token === token) await rm(target, { force: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (now().getTime() - (await stat(target)).mtimeMs > LOCK_STALE_MS) {
          await rm(target, { force: true });
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw statError;
      }
      if (now().getTime() - startedAt >= LOCK_WAIT_MS) throw new VideoQueueError("QUEUE_LOCKED");
      await wait(25);
    }
  }
}

export async function withLockedVideoQueue<T>(
  operation: (store: VideoQueueStore) => Promise<{ store: VideoQueueStore; value: T }> | { store: VideoQueueStore; value: T },
  options: { root?: string; now?: () => Date; wait?: (milliseconds: number) => Promise<void> } = {},
): Promise<T> {
  const root = options.root ?? videoQueueRuntimePath();
  const lock = await acquireVideoQueueLock(root, options);
  try {
    const current = await loadVideoQueueStore(root);
    const before = JSON.stringify(current);
    const result = await operation(current);
    if (JSON.stringify(result.store) !== before) await saveVideoQueueStore(result.store, root);
    return result.value;
  } finally { await lock.release(); }
}

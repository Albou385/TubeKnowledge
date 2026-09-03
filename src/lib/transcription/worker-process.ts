import { spawn, type ChildProcessByStdio } from "node:child_process";
import readline from "node:readline";
import type { Readable } from "node:stream";

import { appendBoundedLog, parseWorkerLine } from "./protocol";
import { TranscriptionPublicError, workerFailure } from "./public-errors";
import type { WorkerEvent } from "./schemas";

export interface WorkerRunOptions {
  cwd: string;
  timeoutMs: number;
  environment?: NodeJS.ProcessEnv;
  onEvent: (event: WorkerEvent, rawLine: string) => Promise<void> | void;
  onSpawn?: (process: WorkerChildProcess) => void;
  unavailableCode?: "PYTHON_RUNTIME_UNAVAILABLE";
}

export type WorkerChildProcess = ChildProcessByStdio<null, Readable, Readable>;

export interface WorkerRunResult {
  result: Record<string, unknown>;
  stderr: string;
}

export function classifyWorkerExit(stderr: string): TranscriptionPublicError {
  const normalized = stderr.toLowerCase();
  if (normalized.includes("certificate_verify_failed") || normalized.includes("certificate verify failed")) return workerFailure("YOUTUBE_ACCESS_FAILED");
  if (normalized.includes("no module named") && normalized.includes("tubeknowledge_worker")) return workerFailure("PYTHON_RUNTIME_INVALID");
  if (normalized.includes("permission denied") || normalized.includes("access is denied") || normalized.includes("no space left")) return workerFailure("TRANSCRIPTION_STORAGE_FAILED");
  return workerFailure("WORKER_FAILED");
}

export function safeStderrSummary(stderr: string): string {
  if (!stderr.trim()) return "stderr absent";
  const classified = classifyWorkerExit(stderr).code;
  return `stderr présent; catégorie ${classified}; ${Buffer.byteLength(stderr, "utf8")} octets`;
}

export async function terminateProcessTree(child: WorkerChildProcess, graceMs = 500): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  if (process.platform === "win32" && child.pid) {
    await runTaskkill(child.pid, false);
    await new Promise((resolve) => setTimeout(resolve, graceMs));
    if (child.exitCode === null) {
      const killedTree = await runTaskkill(child.pid, true);
      if (!killedTree && child.exitCode === null) child.kill("SIGKILL");
    }
    return;
  }
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, graceMs));
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function runTaskkill(pid: number, force: boolean): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const args = ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
    const killer = spawn("taskkill", args, { shell: false, windowsHide: true, stdio: "ignore" });
    killer.once("exit", (code) => resolve(code === 0));
    killer.once("error", () => resolve(false));
  });
}

export function runWorkerProcess(command: string, args: string[], options: WorkerRunOptions): { promise: Promise<WorkerRunResult>; cancel: () => Promise<void> } {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.environment,
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  options.onSpawn?.(child);
  let stderr = "";
  let result: Record<string, unknown> | null = null;
  let failed: Error | null = null;
  let settled = false;
  child.stderr.on("data", (chunk: Buffer) => { stderr = appendBoundedLog(stderr, chunk.toString("utf8")); });

  const promise = new Promise<WorkerRunResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      failed = new TranscriptionPublicError("WORKER_TIMEOUT", 504);
      void terminateProcessTree(child);
    }, options.timeoutMs);
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    let chain = Promise.resolve();
    lines.on("line", (line) => {
      chain = chain.then(async () => {
        if (!line.trim()) return;
        const event = parseWorkerLine(line);
        await options.onEvent(event, line);
        if (event.type === "completed") result = event.result;
        if (event.type === "failed") {
          console.error("[TubeKnowledge worker event]", event.code, event.message);
          failed = workerFailure(event.code, event.message);
        }
      }).catch((error: unknown) => {
        console.error("[TubeKnowledge worker protocol]", error);
        failed = new TranscriptionPublicError("WORKER_PROTOCOL_INVALID", 502, { cause: error });
        void terminateProcessTree(child);
      });
    });
    child.once("error", (error) => {
      console.error("[TubeKnowledge worker spawn]", error);
      failed = new TranscriptionPublicError(options.unavailableCode ?? "WORKER_FAILED", 503, { cause: error });
    });
    child.once("close", (code) => {
      void chain.finally(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (failed) reject(failed);
        else if (code !== 0) {
          const classified = classifyWorkerExit(stderr);
          console.error("[TubeKnowledge worker exit]", { code, stderr: safeStderrSummary(stderr), category: classified.code });
          reject(classified);
        }
        else if (!result) reject(new TranscriptionPublicError("WORKER_PROTOCOL_INVALID", 502));
        else resolve({ result, stderr });
      });
    });
  });
  return { promise, cancel: () => terminateProcessTree(child) };
}

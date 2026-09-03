import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { transcriptionApiError } from "./api-errors";
import { clientErrorMessage } from "./client-errors";
import { PUBLIC_TRANSCRIPTION_ERRORS } from "./error-catalog";
import { runWorkerProcess } from "./worker-process";

const roots: string[] = [];
const secretProfile = "C:\\private";
const secretRepository = `${secretProfile}\\source\\repository`;
const secretRuntime = `${secretProfile}\\runtime\\TubeKnowledge`;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })));
});

async function fakeWorker(event: Record<string, unknown>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-public-error-"));
  roots.push(root);
  const file = path.join(root, "worker.cjs");
  await writeFile(file, `console.log(${JSON.stringify(JSON.stringify(event))}); process.exitCode=1;`, "utf8");
  return { root, file };
}

async function responseText(error: unknown, fallback: "INSPECTION_FAILED" | "TRANSCRIPTION_FAILED") {
  const response = transcriptionApiError(error, fallback, 400);
  return { response, text: await response.text() };
}

function expectNoLocalPath(text: string) {
  expect(text).not.toContain("C:\\");
  expect(text).not.toContain(secretProfile);
  expect(text).not.toContain(secretRepository);
  expect(text).not.toContain(secretRuntime);
  expect(text).not.toContain(".venv-transcription");
}

describe("erreurs publiques de transcription", () => {
  it("convertit un runtime Python absent sans exposer son chemin dans la réponse API", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const root = await mkdtemp(path.join(os.tmpdir(), "tk-missing-python-"));
    roots.push(root);
    const missingPython = path.join(root, "runtime-inexistant", "python.exe");
    const runner = runWorkerProcess(missingPython, ["-m", "tubeknowledge_worker.cli", "health"], {
      cwd: root, timeoutMs: 2_000, unavailableCode: "PYTHON_RUNTIME_UNAVAILABLE", onEvent: () => undefined,
    });
    const error = await runner.promise.catch((cause: unknown) => cause);
    const { response, text } = await responseText(error, "INSPECTION_FAILED");
    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ error: { code: "PYTHON_RUNTIME_UNAVAILABLE", message: PUBLIC_TRANSCRIPTION_ERRORS.PYTHON_RUNTIME_UNAVAILABLE } });
    expectNoLocalPath(text);
  });

  it.each([
    ["FFMPEG_UNAVAILABLE", "FFMPEG_UNAVAILABLE", `${secretProfile}\\tools\\ffmpeg.exe`],
    ["FFPROBE_UNAVAILABLE", "FFPROBE_UNAVAILABLE", `${secretProfile}\\tools\\ffprobe.exe`],
  ] as const)("neutralise %s et ses détails techniques", async (workerCode, expectedCode, toolPath) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { root, file } = await fakeWorker({ type: "failed", code: workerCode, message: `spawn ${toolPath} ENOENT; runtime=${secretRuntime}` });
    const runner = runWorkerProcess(process.execPath, [file], { cwd: root, timeoutMs: 2_000, onEvent: () => undefined });
    const error = await runner.promise.catch((cause: unknown) => cause);
    const { text } = await responseText(error, "TRANSCRIPTION_FAILED");
    expect(JSON.parse(text).error.code).toBe(expectedCode);
    expectNoLocalPath(text);
  });

  it.each([
    "SUBTITLE_DOWNLOAD_FAILED",
    "SUBTITLE_NOT_AVAILABLE",
    "YOUTUBE_ACCESS_FAILED",
    "YOUTUBE_RATE_LIMITED",
    "TRANSCRIPT_NORMALIZATION_FAILED",
    "TRANSCRIPTION_TIMEOUT",
    "TRANSCRIPTION_STORAGE_FAILED",
  ] as const)("expose seulement le code fermé %s", async (workerCode) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { root, file } = await fakeWorker({ type: "failed", code: workerCode, message: `secret=${secretRuntime}` });
    const runner = runWorkerProcess(process.execPath, [file], { cwd: root, timeoutMs: 2_000, onEvent: () => undefined });
    const error = await runner.promise.catch((cause: unknown) => cause);
    const { text } = await responseText(error, "TRANSCRIPTION_FAILED");
    expect(JSON.parse(text).error).toEqual({ code: workerCode, message: PUBLIC_TRANSCRIPTION_ERRORS[workerCode] });
    expectNoLocalPath(text);
  });

  it("n’envoie jamais une erreur Node brute inconnue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const raw = Object.assign(new Error(`spawn ${secretRuntime} ENOENT`), { code: "ENOENT" });
    const { text } = await responseText(raw, "INSPECTION_FAILED");
    expect(JSON.parse(text)).toEqual({ error: { code: "INSPECTION_FAILED", message: PUBLIC_TRANSCRIPTION_ERRORS.INSPECTION_FAILED } });
    expectNoLocalPath(text);
  });

  it("conserve un code fermé provenant d’un module rechargé sans faire confiance au message", async () => {
    const reloadedError = { code: "YOUTUBE_RATE_LIMITED", status: 418, message: `secret=${secretRuntime}` };
    const { response, text } = await responseText(reloadedError, "TRANSCRIPTION_FAILED");
    expect(response.status).toBe(503);
    expect(JSON.parse(text).error).toEqual({ code: "YOUTUBE_RATE_LIMITED", message: PUBLIC_TRANSCRIPTION_ERRORS.YOUTUBE_RATE_LIMITED });
    expectNoLocalPath(text);
  });

  it("l’interface ignore le message serveur et les anciens payloads texte", () => {
    const malicious = { code: "PYTHON_RUNTIME_UNAVAILABLE", message: `spawn ${secretRepository} ENOENT` };
    const rendered = clientErrorMessage(malicious, "Erreur générique.");
    expect(rendered).toBe(PUBLIC_TRANSCRIPTION_ERRORS.PYTHON_RUNTIME_UNAVAILABLE);
    expectNoLocalPath(rendered);
    expect(clientErrorMessage(`spawn ${secretRuntime} ENOENT`, "Erreur générique.")).toBe("Erreur générique.");
  });
});

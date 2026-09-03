import path from "node:path";

import { describe, expect, it } from "vitest";

import { inspectTranscriptionHealth, summarizeRecentExecution, type CommandProbe, type ProbeResult } from "./health";
import type { AcquisitionJob } from "./types";

function probeFrom(entries: Record<string, ProbeResult>): CommandProbe {
  return async (command, args) => entries[`${command}|${args.join(" ")}`] ?? entries[command] ?? "missing";
}

describe("diagnostic cohérent de transcription", () => {
  it("distingue disponibilité, test non effectué et échec réel récent", () => {
    expect(summarizeRecentExecution([])).toMatchObject({ realExecution: "not-tested", item: { status: "OPTIONNEL" } });
    const failed = {
      schemaVersion: 1, id: "11111111-1111-4111-8111-111111111111", createdAt: "2026-07-27T00:00:00.000Z", updatedAt: "2026-07-27T01:00:00.000Z",
      status: "failed", stage: "failed", progress: null, message: "fixture", warnings: [], artifacts: [], error: { code: "YOUTUBE_ACCESS_FAILED", message: "fixture" },
    } satisfies AcquisitionJob;
    expect(summarizeRecentExecution([failed])).toMatchObject({ realExecution: "failed", recentFailureCode: "YOUTUBE_ACCESS_FAILED", item: { status: "INCOMPATIBLE" } });
    expect(summarizeRecentExecution([{ ...failed, error: { code: "WORKER_FAILED", message: "fixture" } }], "YOUTUBE_RATE_LIMITED")).toMatchObject({ recentFailureCode: "YOUTUBE_RATE_LIMITED" });
  });
  it("ne considère pas un chemin Python configuré comme OK sans --version", async () => {
    const configured = path.resolve("C:/missing/python.exe");
    const result = await inspectTranscriptionHealth({
      NODE_ENV: "test",
      TUBEKNOWLEDGE_RUNTIME_PATH: path.resolve("C:/runtime"),
      TUBEKNOWLEDGE_PYTHON_PATH: configured,
    }, probeFrom({ [configured]: "missing", py: "incompatible", python: "ok", ffmpeg: "missing", ffprobe: "missing", "nvidia-smi": "missing" }));
    const items = Object.fromEntries(result.items.map((item) => [item.name, item]));
    expect(items["Python configuré"]).toMatchObject({ status: "MANQUANT", detail: "Exécutable configuré introuvable." });
    expect(items["Launcher py"]).toMatchObject({ status: "INCOMPATIBLE" });
    expect(items["Runtime global"]).toMatchObject({ status: "OK" });
    expect(items.venv).toMatchObject({ status: "MANQUANT" });
    expect(items["Python actif"]).toMatchObject({ status: "MANQUANT" });
    expect(items.worker).toMatchObject({ status: "MANQUANT" });
    expect(result.status).toBe("incomplete");
  });

  it("distingue un exécutable configuré présent mais incompatible", async () => {
    const configured = path.resolve("C:/configured/python.exe");
    const result = await inspectTranscriptionHealth({
      NODE_ENV: "test",
      TUBEKNOWLEDGE_RUNTIME_PATH: path.resolve("C:/runtime"),
      TUBEKNOWLEDGE_PYTHON_PATH: configured,
    }, probeFrom({ [configured]: "incompatible" }));
    expect(result.items.find((item) => item.name === "Python configuré")?.status).toBe("INCOMPATIBLE");
    expect(result.items.find((item) => item.name === "Python actif")?.status).toBe("INCOMPATIBLE");
  });
});


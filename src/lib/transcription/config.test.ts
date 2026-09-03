import path from "node:path";

import { describe, expect, it } from "vitest";

import { getTranscriptionConfig, isInsidePath, WHISPER_PROFILES } from "./config";

describe("configuration de transcription", () => {
  it("applique les valeurs CPU-first", () => {
    const config = getTranscriptionConfig({ NODE_ENV: "test", TUBEKNOWLEDGE_RUNTIME_PATH: path.resolve("C:/runtime-test") });
    expect(config).toMatchObject({ concurrency: 1, defaultModel: "small", defaultDevice: "cpu", defaultComputeType: "int8", maxVideoMinutes: 360 });
    expect(WHISPER_PROFILES.fast).toEqual({ model: "small", device: "cpu", computeType: "int8" });
    expect(WHISPER_PROFILES.balanced.model).toBe("medium");
    expect(WHISPER_PROFILES.quality.model).toBe("large-v3");
  });

  it("résout le runtime explicite, le fallback local et refuse un chemin relatif", () => {
    const explicit = path.resolve("C:/runtime explicite/écriture");
    expect(getTranscriptionConfig({ NODE_ENV: "test", TUBEKNOWLEDGE_RUNTIME_PATH: explicit }).runtimePath).toBe(path.normalize(explicit));
    const local = path.resolve("C:/local-app-data");
    expect(getTranscriptionConfig({ NODE_ENV: "test", LOCALAPPDATA: local }).runtimePath).toBe(path.join(local, "TubeKnowledge", "runtime"));
    expect(() => getTranscriptionConfig({ NODE_ENV: "test", TUBEKNOWLEDGE_RUNTIME_PATH: "runtime-relatif" })).toThrow("chemin absolu");
  });

  it("borne la concurrence à deux", () => {
    expect(getTranscriptionConfig({ NODE_ENV: "test", TUBEKNOWLEDGE_RUNTIME_PATH: path.resolve("C:/runtime-test"), TUBEKNOWLEDGE_TRANSCRIPTION_CONCURRENCY: "2" }).concurrency).toBe(2);
    expect(getTranscriptionConfig({ NODE_ENV: "test", TUBEKNOWLEDGE_RUNTIME_PATH: path.resolve("C:/runtime-test"), TUBEKNOWLEDGE_TRANSCRIPTION_CONCURRENCY: "99" }).concurrency).toBe(1);
  });

  it("refuse le runtime dans le vault ou OneDrive", () => {
    const vault = path.resolve("C:/data/vault");
    expect(() => getTranscriptionConfig({ NODE_ENV: "test", YOUTUBE_LIBRARY_PATH: vault, TUBEKNOWLEDGE_RUNTIME_PATH: path.join(vault, "runtime") })).toThrow("hors du vault");
    expect(() => getTranscriptionConfig({ NODE_ENV: "test", OneDrive: path.resolve("C:/OneDrive"), TUBEKNOWLEDGE_RUNTIME_PATH: path.resolve("C:/OneDrive/runtime") })).toThrow("hors de OneDrive");
  });

  it("compare les chemins sans confusion de préfixe", () => {
    expect(isInsidePath("C:/root", "C:/root/child")).toBe(true);
    expect(isInsidePath("C:/root", "C:/root-evil/child")).toBe(false);
  });
});


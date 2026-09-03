import { describe, expect, it } from "vitest";

import { startAcquisitionSchema } from "./schemas";

const jobId = "123e4567-e89b-42d3-a456-426614174000";

describe("schéma de démarrage d’acquisition", () => {
  it("accepte les identifiants de piste yt-dlp multi-segments bornés", () => {
    expect(startAcquisitionSchema.parse({ jobId, source: { kind: "subtitles", language: "en-j3PyPqV-e1s", origin: "manual", format: "vtt" } }).source).toMatchObject({ language: "en-j3PyPqV-e1s" });
  });

  it.each(["en;--proxy", "en/../../vault", "en -f", "https://example.test", "en_j3PyPqV", "en-a-b-c-d-e"]) ("refuse un identifiant de piste non borné ou ambigu : %s", (language) => {
    expect(() => startAcquisitionSchema.parse({ jobId, source: { kind: "subtitles", language, origin: "manual", format: "vtt" } })).toThrow();
  });
});

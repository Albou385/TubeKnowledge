import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const confirmedYtDlpVersion = "2026.7.4";
const invalidYtDlpVersion = ["2026", "7", "15"].join(".");
const unconfirmedYtDlpVersion = ["2026", "7", "21"].join(".");

describe("pins du worker de transcription", () => {
  it("utilise dans les deux manifests le pin yt-dlp confirmé par pip index", async () => {
    const [requirements, pyproject] = await Promise.all([
      readFile("transcription-worker/requirements.txt", "utf8"),
      readFile("transcription-worker/pyproject.toml", "utf8"),
    ]);
    expect(requirements).toContain(`yt-dlp==${confirmedYtDlpVersion}`);
    expect(pyproject).toContain(`yt-dlp==${confirmedYtDlpVersion}`);
    expect(requirements.match(/^yt-dlp==.+$/gm)).toEqual([`yt-dlp==${confirmedYtDlpVersion}`]);
    expect(pyproject.match(/"yt-dlp==.+"/g)).toEqual([`"yt-dlp==${confirmedYtDlpVersion}"`]);
  });

  it("ne conserve ni l’ancien pin invalide ni un pin non confirmé", async () => {
    const contents = await Promise.all([
      readFile("transcription-worker/requirements.txt", "utf8"),
      readFile("transcription-worker/pyproject.toml", "utf8"),
    ]);
    for (const content of contents) {
      expect(content).not.toContain(invalidYtDlpVersion);
      expect(content).not.toContain(unconfirmedYtDlpVersion);
      expect(content).toContain("faster-whisper==1.2.1");
    }
  });
});

import os from "node:os";
import path from "node:path";

import { defineConfig } from "@playwright/test";

const qaRoot = path.join(os.tmpdir(), "tubeknowledge-phase10-3-playwright");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "phase10-3-resume.spec.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3418", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "npx tsx scripts/seed-overnight-qa.ts && npm run dev -- --hostname 127.0.0.1 --port 3418",
    url: "http://127.0.0.1:3418/api/health",
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      TUBEKNOWLEDGE_QA_ROOT: qaRoot,
      YOUTUBE_LIBRARY_PATH: path.join(qaRoot, "vault"),
      TUBEKNOWLEDGE_RUNTIME_PATH: path.join(qaRoot, "runtime"),
      TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(qaRoot, "state"),
      TUBEKNOWLEDGE_BACKUP_PATH: path.join(qaRoot, "backups"),
      TUBEKNOWLEDGE_ONEDRIVE_ROOT: path.join(qaRoot, "vault"),
      TUBEKNOWLEDGE_MACHINE_NAME: "Phase 10.3 QA",
      TUBEKNOWLEDGE_MACHINE_ROLE: "reader",
      TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0",
      TUBEKNOWLEDGE_ANALYSIS_PROVIDER: "manual",
      TUBEKNOWLEDGE_ENABLE_PAID_AI: "false",
      OPENAI_API_KEY: "",
    },
  },
});

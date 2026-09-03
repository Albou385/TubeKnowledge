import os from "node:os";
import path from "node:path";

import { defineConfig } from "@playwright/test";

const qaRoot = path.join(os.tmpdir(), "tubeknowledge-expired-local-conflict-qa");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "expired-local-conflict-reacquire.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: path.join(os.tmpdir(), "tubeknowledge-expired-local-conflict-playwright"),
  use: { baseURL: "http://127.0.0.1:3421", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "npx tsx scripts/seed-expired-local-conflict-qa.ts && npm run build && npm run start -- --hostname 127.0.0.1 --port 3421",
    url: "http://127.0.0.1:3421/api/health",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      TUBEKNOWLEDGE_QA_ROOT: qaRoot,
      YOUTUBE_LIBRARY_PATH: path.join(qaRoot, "OneDrive", "vault"),
      TUBEKNOWLEDGE_RUNTIME_PATH: path.join(qaRoot, "runtime"),
      TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(qaRoot, "state"),
      TUBEKNOWLEDGE_BACKUP_PATH: path.join(qaRoot, "backups"),
      TUBEKNOWLEDGE_ONEDRIVE_ROOT: path.join(qaRoot, "OneDrive"),
      TUBEKNOWLEDGE_MACHINE_NAME: "Portable QA",
      TUBEKNOWLEDGE_MACHINE_ROLE: "writer",
      TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0",
      TUBEKNOWLEDGE_ANALYSIS_PROVIDER: "manual",
      TUBEKNOWLEDGE_ENABLE_PAID_AI: "false",
      OPENAI_API_KEY: "",
    },
  },
});

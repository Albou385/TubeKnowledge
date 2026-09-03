import os from "node:os";
import path from "node:path";

import { defineConfig } from "@playwright/test";

const qaRoot = path.join(os.tmpdir(), "tubeknowledge-phase10-4-playwright");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "phase10-4-apply-session.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3419", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    command: "npx tsx scripts/seed-phase10-4-qa.ts && npm run dev -- --hostname 127.0.0.1 --port 3419",
    url: "http://127.0.0.1:3419/api/health",
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      TUBEKNOWLEDGE_QA_ROOT: qaRoot,
      TUBEKNOWLEDGE_NEXT_DIST_DIR: ".next-phase10-4",
      YOUTUBE_LIBRARY_PATH: path.join(qaRoot, "OneDrive", "vault"),
      TUBEKNOWLEDGE_RUNTIME_PATH: path.join(qaRoot, "runtime"),
      TUBEKNOWLEDGE_IMPORT_SESSION_PATH: path.join(qaRoot, "import-sessions"),
      TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(qaRoot, "state"),
      TUBEKNOWLEDGE_BACKUP_PATH: path.join(qaRoot, "backups"),
      TUBEKNOWLEDGE_ONEDRIVE_ROOT: path.join(qaRoot, "OneDrive"),
      TUBEKNOWLEDGE_MACHINE_NAME: "Phase 10.4 QA",
      TUBEKNOWLEDGE_MACHINE_ROLE: "writer",
      TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0",
      TUBEKNOWLEDGE_ANALYSIS_PROVIDER: "manual",
      TUBEKNOWLEDGE_ENABLE_PAID_AI: "false",
      OPENAI_API_KEY: "",
    },
  },
});

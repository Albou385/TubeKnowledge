import os from "node:os";
import path from "node:path";

import { defineConfig } from "@playwright/test";

const qaRoot = path.join(os.tmpdir(), "tubeknowledge-phase11b-playwright");
const externalWebServer = process.env.TUBEKNOWLEDGE_PHASE11B_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "phase11b-video-queue.spec.ts",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3420", browserName: "chromium", trace: "retain-on-failure" },
  webServer: externalWebServer ? undefined : {
    command:
      "node --import ./scripts/node-tsx-windows-bootstrap.mjs --import tsx scripts/seed-phase11b-qa.ts && node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3420",
    url: "http://127.0.0.1:3420/api/health",
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      TUBEKNOWLEDGE_QA_ROOT: qaRoot,
      TUBEKNOWLEDGE_NEXT_DIST_DIR: ".next-phase11b",
      YOUTUBE_LIBRARY_PATH: path.join(qaRoot, "vault"),
      TUBEKNOWLEDGE_RUNTIME_PATH: path.join(qaRoot, "runtime"),
      TUBEKNOWLEDGE_IMPORT_SESSION_PATH: path.join(qaRoot, "import-sessions"),
      TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(qaRoot, "state"),
      TUBEKNOWLEDGE_BACKUP_PATH: path.join(qaRoot, "backups"),
      TUBEKNOWLEDGE_ONEDRIVE_ROOT: path.join(qaRoot, "OneDrive"),
      TUBEKNOWLEDGE_MACHINE_NAME: "Phase 11B QA",
      TUBEKNOWLEDGE_MACHINE_ROLE: "reader",
      TUBEKNOWLEDGE_ANALYSIS_PROVIDER: "manual",
      TUBEKNOWLEDGE_ENABLE_PAID_AI: "false",
      OPENAI_API_KEY: "",
    },
  },
});


import os from "node:os";
import path from "node:path";

import { defineConfig } from "@playwright/test";

const qaRoot = path.join(os.tmpdir(), "tubeknowledge-playwright-qa");

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:3417", browserName: "chromium", trace: "retain-on-failure" },
  webServer: {
    // Le serveur de production évite le verrou global de `next dev` lorsqu'une
    // session locale est déjà ouverte. Le build reçoit uniquement la fixture QA.
    command: "npx tsx scripts/seed-overnight-qa.ts && npm run build && npm run start -- --hostname 127.0.0.1 --port 3417",
    url: "http://127.0.0.1:3417/api/health",
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      ...process.env,
      TUBEKNOWLEDGE_QA_ROOT: qaRoot,
      YOUTUBE_LIBRARY_PATH: path.join(qaRoot, "vault"),
      TUBEKNOWLEDGE_RUNTIME_PATH: path.join(qaRoot, "runtime"),
      TUBEKNOWLEDGE_IMPORT_SESSION_PATH: path.join(qaRoot, "import-sessions"),
      TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(qaRoot, "state"),
      TUBEKNOWLEDGE_BACKUP_PATH: path.join(qaRoot, "backups"),
      TUBEKNOWLEDGE_ONEDRIVE_ROOT: path.join(qaRoot, "vault"),
      TUBEKNOWLEDGE_MACHINE_NAME: "Portable QA",
      TUBEKNOWLEDGE_MACHINE_ROLE: "reader",
      TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0",
      TUBEKNOWLEDGE_ANALYSIS_PROVIDER: "manual",
      TUBEKNOWLEDGE_ENABLE_PAID_AI: "false",
      OPENAI_API_KEY: "",
    },
  },
});

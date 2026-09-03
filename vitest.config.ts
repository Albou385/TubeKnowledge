import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Plusieurs suites locales lancent de vrais processus PowerShell/Python.
    // En CI, l'isolation par fichiers du runner reste nécessaire au job Windows ciblé.
    ...(process.env.CI ? {} : { maxWorkers: 1 }),
    coverage: {
      reporter: ["text", "html"],
    },
  },
});

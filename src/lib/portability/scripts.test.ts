import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const scripts = ["configure-portability.ps1", "check-portability.ps1", "bootstrap-secondary-machine.ps1", "create-portability-backup.ps1", "verify-portability-backup.ps1", "restore-portability-backup.ps1", "phase6-smoke-fake.ps1", "phase6-manual-check.ps1", "diagnose-portability-state.ps1", "plan-portability-recovery.ps1", "maintain-portability-local-state.ps1", "phase6-operational-manual-check.ps1"];

describe("scripts Windows Phase 6", () => {
  it("livre les scripts fail-fast et UTF-8", async () => { for (const name of scripts) { const content = await readFile(`scripts/${name}`, "utf8"); expect(content).toContain("$ErrorActionPreference = 'Stop'"); expect(content).toContain("UTF8Encoding"); } });
  it("ne contient aucun chemin personnel, secret, API Microsoft ou remote Git", async () => { const content = (await Promise.all(scripts.map((name) => readFile(`scripts/${name}`, "utf8")))).join("\n"); expect(content).not.toMatch(/C:\\Users\\admin|client_secret|graph\.microsoft|git remote add/i); });
  it("protège .env.local et le restore in-place", async () => { const configure = await readFile("scripts/configure-portability.ps1", "utf8"); const restore = await readFile("scripts/restore-portability-backup.ps1", "utf8"); expect(configure).toContain("$WriteEnvFile"); expect(configure).toContain("ECRIRE"); expect(restore).toContain("Aucune restauration in-place"); });
  it("garde diagnostic et plan read-only, maintenance en dry-run par défaut", async () => { const diagnostic = await readFile("scripts/diagnose-portability-state.ps1", "utf8"); const plan = await readFile("scripts/plan-portability-recovery.ps1", "utf8"); const maintenance = await readFile("scripts/maintain-portability-local-state.ps1", "utf8"); expect(diagnostic).toContain("'diagnose'"); expect(plan).toContain("'plan-recovery'"); expect(plan).toContain("Aucune action"); expect(maintenance).toContain("[switch]$Apply"); expect(maintenance).toContain("NETTOYER"); expect(maintenance).toContain("Dry-run"); });
});


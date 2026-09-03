import { loadEnvConfig } from "@next/env";
import { parseLibraryConfig } from "../src/lib/config/library-config";
import { createPortabilityBackup } from "../src/lib/portability/backup-builder";
import { verifyPortabilityBackup } from "../src/lib/portability/backup-reader";
import { getPortabilityConfig } from "../src/lib/portability/config";
import { ensureMachineIdentity } from "../src/lib/portability/machine-identity";
import { previewRestore } from "../src/lib/portability/restore-preview";
import { applyRestore } from "../src/lib/portability/restore-apply";
import { getPortabilityStatus } from "../src/lib/portability/status";
import { diagnosePortabilityState, planPortabilityRecovery } from "../src/lib/portability/diagnostics";
import { applyLocalMaintenance, inspectLocalMaintenance } from "../src/lib/portability/maintenance";

function value(name: string): string { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`Argument requis : ${name}`); return process.argv[index + 1]; }
async function main() { loadEnvConfig(process.cwd()); const action = process.argv[2]; const config = getPortabilityConfig();
  if (action === "status") { console.log(JSON.stringify(await getPortabilityStatus(), null, 2)); return; }
  if (action === "diagnose") { console.log(JSON.stringify(await diagnosePortabilityState(), null, 2)); return; }
  if (action === "plan-recovery") { console.log(JSON.stringify(await planPortabilityRecovery(), null, 2)); return; }
  if (action === "maintenance") {
    const result = process.argv.includes("--apply") ? await applyLocalMaintenance(config, value("--confirmation")) : await inspectLocalMaintenance(config);
    const publicResult = "targets" in result ? { ...result, targets: undefined } : result;
    console.log(JSON.stringify(publicResult, null, 2));
    return;
  }
  const library = parseLibraryConfig(); if (!library.ok) throw new Error(library.message); const identity = await ensureMachineIdentity(config);
  if (action === "backup") { const profile = (process.argv.includes("--full") ? "full" : "knowledge") as "full" | "knowledge"; const backup = await createPortabilityBackup(library.rootPath, config, identity, profile); console.log(JSON.stringify({ backupId: backup.backupId, verified: backup.verified, zipSha256: backup.zipSha256 }, null, 2)); return; }
  if (action === "verify") { const verified = await verifyPortabilityBackup(config, value("--backup")); console.log(JSON.stringify({ backupId: verified.record.backupId, verified: true, rootHash: verified.record.manifest.sourceRootHash }, null, 2)); return; }
  if (action === "restore-staging") { const backupId = value("--backup"); const targetRoot = value("--staging"); const preview = await previewRestore(config, { backupId, mode: "restore-to-staging", targetRoot }); const result = await applyRestore(config, process.env, { restoreId: preview.restoreId, confirmed: true }); console.log(JSON.stringify(result, null, 2)); return; }
  throw new Error("Action inconnue.");
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Commande Phase 6 échouée."); process.exitCode = 1; });


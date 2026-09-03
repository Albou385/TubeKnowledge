import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:net";

import { parseLibraryConfig } from "../src/lib/config/library-config";
import { createPortabilityBackup } from "../src/lib/portability/backup-builder";
import { bootstrapWriter } from "../src/lib/portability/bootstrap-writer";
import { latestCheckpoint } from "../src/lib/portability/checkpoints";
import { getPortabilityConfig } from "../src/lib/portability/config";
import { detectConflicts } from "../src/lib/portability/conflicts";
import { ensureMachineIdentity } from "../src/lib/portability/machine-identity";
import { applyRestore } from "../src/lib/portability/restore-apply";
import { previewRestore } from "../src/lib/portability/restore-preview";
import { createVaultSnapshot } from "../src/lib/portability/snapshots";
import { reacquireWriter, renewWriter } from "../src/lib/portability/writer-operations";

async function fingerprint(root: string | undefined): Promise<string | null> {
  if (!root) return null;
  try {
    const hash = createHash("sha256");
    async function visit(directory: string) {
      for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
        const target = path.join(directory, entry.name);
        const details = await lstat(target);
        if (details.isSymbolicLink()) continue;
        hash.update(path.relative(root!, target).split(path.sep).join("/"));
        if (details.isDirectory()) await visit(target);
        else if (details.isFile()) hash.update(await readFile(target));
      }
    }
    await visit(root);
    return hash.digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function fileFingerprint(filePath: string): Promise<string | null> {
  try {
    return createHash("sha256").update(await readFile(filePath)).digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function verifyStatusApi(environment: NodeJS.ProcessEnv): Promise<void> {
  const port = await availablePort();
  const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], { cwd: process.cwd(), env: environment, windowsHide: true, stdio: "ignore" });
  try {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (child.exitCode !== null) throw new Error("Le serveur temporaire Next.js s’est arrêté.");
      try {
        response = await fetch(`http://127.0.0.1:${port}/api/portability/status`, { cache: "no-store" });
        if (response.ok) break;
      } catch {
        // Le serveur temporaire démarre encore.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!response?.ok) throw new Error("API status temporaire indisponible.");
    const payload = await response.json() as { status?: { writer?: { state?: string; status?: string; active?: boolean } } };
    if (!payload.status?.writer?.state) throw new Error("Contrat API writer incomplet.");
    if (payload.status.writer.status === "active" && payload.status.writer.active === false) throw new Error("Contrat API writer contradictoire.");
  } finally {
    child.kill();
  }
}

async function main() {
  loadEnvConfig(process.cwd());
  const library = parseLibraryConfig();
  if (!library.ok) throw new Error(library.message);
  const realConfig = getPortabilityConfig();
  const before = {
    vault: await fingerprint(library.rootPath),
    state: await fingerprint(realConfig.statePath),
    backups: await fingerprint(realConfig.backupPath),
    env: await fileFingerprint(path.join(process.cwd(), ".env.local")),
  };
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-p61-manual-"));
  try {
    const oneDrive = path.join(root, "OneDrive");
    const vault = path.join(oneDrive, "vault");
    const realSnapshot = await createVaultSnapshot(library.rootPath, "00000000-0000-4000-8000-000000000000");
    for (const file of realSnapshot.files) {
      const target = path.join(vault, ...file.path.split("/"));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(path.join(library.rootPath, ...file.path.split("/"))));
    }
    const environment = { ...process.env, YOUTUBE_LIBRARY_PATH: vault, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups"), TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive, TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0", TUBEKNOWLEDGE_WRITER_LEASE_MINUTES: "30", TUBEKNOWLEDGE_MACHINE_NAME: "Tour manual-check", TUBEKNOWLEDGE_MACHINE_ROLE: "writer" };
    const config = getPortabilityConfig(environment);
    const identity = await ensureMachineIdentity(config);
    const backup = await createPortabilityBackup(vault, config, identity, "knowledge", { trigger: "manual-check" });
    const start = new Date("2026-07-23T12:00:00Z");
    const boot = await bootstrapWriter({ idempotencyKey: randomUUID(), backupId: backup.backupId, confirmationText: "REPRENDRE" }, environment, { now: start, wait: async () => undefined });
    const renewKey = randomUUID();
    const renewed = await renewWriter(renewKey, environment, { now: new Date("2026-07-23T12:05:00Z"), wait: async () => undefined });
    const renewReplay = await renewWriter(renewKey, environment, { now: new Date("2026-07-23T12:06:00Z"), wait: async () => undefined });
    if (renewed.authority.expiresAt !== renewReplay.authority.expiresAt) throw new Error("Replay renew invalide.");
    const reacquireKey = randomUUID();
    const reacquired = await reacquireWriter({ idempotencyKey: reacquireKey, backupId: backup.backupId, confirmationText: "REACQUERIR" }, environment, { now: new Date("2026-07-23T12:36:00Z"), wait: async () => undefined });
    const reacquireReplay = await reacquireWriter({ idempotencyKey: reacquireKey, backupId: backup.backupId, confirmationText: "REACQUERIR" }, environment, { now: new Date("2026-07-23T12:37:00Z"), wait: async () => undefined });
    if (reacquired.authority.authorityId !== reacquireReplay.authority.authorityId || reacquired.checkpointCreated) throw new Error("Replay reacquire invalide.");
    const beforeTechnical = await createVaultSnapshot(vault, identity.machineId);
    await createPortabilityBackup(vault, config, identity, "knowledge", { trigger: "manual-check" });
    const afterTechnical = await createVaultSnapshot(vault, identity.machineId);
    if ((await detectConflicts(afterTechnical, config, await latestCheckpoint(vault), { baseSnapshot: beforeTechnical })).length) throw new Error("Faux conflit technique.");
    const markdownPath = afterTechnical.files.find((file) => file.path.endsWith(".md") && file.path !== "INDEX.md")?.path || "INDEX.md";
    const markdownTarget = path.join(vault, ...markdownPath.split("/"));
    await writeFile(markdownTarget, `${await readFile(markdownTarget, "utf8")}\n<!-- manual-check -->\n`);
    const divergent = await createVaultSnapshot(vault, identity.machineId);
    const conflicts = await detectConflicts(divergent, config, boot.checkpoint, { baseSnapshot: afterTechnical });
    if (!conflicts.some((item) => item.type === "content-divergence") || !conflicts.some((item) => item.type === "checkpoint-mismatch")) throw new Error("Conflit Markdown non détecté.");
    const temporaryStateBeforeApi = await fingerprint(config.statePath);
    await verifyStatusApi(environment);
    if (temporaryStateBeforeApi !== await fingerprint(config.statePath)) throw new Error("GET status a modifié le state temporaire.");
    const staging = path.join(root, "staging");
    const restorePreview = await previewRestore(config, { backupId: backup.backupId, mode: "restore-to-staging", targetRoot: staging });
    const restored = await applyRestore(config, environment, { restoreId: restorePreview.restoreId, confirmed: true });
    if (restored.status !== "success") throw new Error("Restore staging temporaire échoué.");
    const after = {
      vault: await fingerprint(library.rootPath),
      state: await fingerprint(realConfig.statePath),
      backups: await fingerprint(realConfig.backupPath),
      env: await fileFingerprint(path.join(process.cwd(), ".env.local")),
    };
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Une ressource réelle a changé pendant le manual-check.");
    console.log("[OK] scénario opérationnel complet reproduit sur une copie temporaire");
    console.log("[OK] bootstrap, renew, expiration et reacquire idempotents; aucun checkpoint superflu");
    console.log("[OK] métadonnées techniques sans conflit; modification Markdown détectée");
    console.log("[OK] API status temporaire cohérente et GET sans effet de bord");
    console.log("[OK] restore staging temporaire réussi; aucune API Microsoft");
    console.log("[OK] vrai vault intact; state réel intact; backups réels intacts");
    console.log("[OK] checkpoints réels intacts; conflit réel intact; .env.local intact");
    console.log("[INFO] Synchronisation cloud non vérifiée.");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Manual-check Phase 6.1 échoué.");
  process.exitCode = 1;
});

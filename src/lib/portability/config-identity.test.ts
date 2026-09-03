import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPortabilityConfig } from "./config";
import { ensureMachineIdentity, loadMachineIdentity, updateMachineIdentity } from "./machine-identity";
import { PortabilityError, publicPortabilityError, PUBLIC_PORTABILITY_ERRORS } from "./errors";

const roots: string[] = [];
async function temp() { const value = await mkdtemp(path.join(os.tmpdir(), "tk-p6-config-")); roots.push(value); return value; }
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("configuration et identité machine", () => {
  it("préserve le mode mono-machine sans state path explicite", () => { expect(getPortabilityConfig({}).enabled).toBe(false); });
  it("valide reader/writer et garde state/backup hors vault et OneDrive", async () => { const root = await temp(); const oneDrive = path.join(root, "OneDrive"); const config = getPortabilityConfig({ YOUTUBE_LIBRARY_PATH: path.join(oneDrive, "vault"), TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups"), TUBEKNOWLEDGE_MACHINE_ROLE: "writer" }); expect(config).toMatchObject({ enabled: true, rolePreference: "writer" }); expect(() => getPortabilityConfig({ TUBEKNOWLEDGE_ONEDRIVE_ROOT: oneDrive, TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(oneDrive, "state") })).toThrow("hors de OneDrive"); });
  it("crée une fois, persiste et modifie seulement nom/rôle", async () => { const root = await temp(); const config = getPortabilityConfig({ TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"), TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups") }); const first = await ensureMachineIdentity(config, { displayName: "Tour", rolePreference: "writer", machineId: "11111111-1111-4111-8111-111111111111", now: new Date("2026-07-22T12:00:00Z") }); const second = await ensureMachineIdentity(config, { displayName: "Autre" }); expect(second).toEqual(first); const updated = await updateMachineIdentity(config, { displayName: "Tour principale", rolePreference: "reader" }); expect(updated).toMatchObject({ machineId: first.machineId, displayName: "Tour principale", rolePreference: "reader" }); });
  it("refuse une identité persistée avec UUID invalide", async () => { const root = await temp(); const config = getPortabilityConfig({ TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: root }); await writeFile(path.join(root, "machine.json"), JSON.stringify({ schemaVersion: 1, machineId: "bad", displayName: "X", createdAt: new Date().toISOString(), rolePreference: "reader" })); await expect(loadMachineIdentity(config)).rejects.toThrow(); });
  it("n’expose jamais les chemins bruts dans le catalogue public", () => { const result = publicPortabilityError(new PortabilityError("VAULT_UNAVAILABLE", { cause: new Error("C:\\Users\\secret") })); expect(result).toEqual({ code: "VAULT_UNAVAILABLE", message: PUBLIC_PORTABILITY_ERRORS.VAULT_UNAVAILABLE }); expect(JSON.stringify(result)).not.toContain("C:\\Users"); });
});


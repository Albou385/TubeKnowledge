import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { PortabilityConfig } from "./config";
import { ensureMachineIdentity, loadMachineIdentity } from "./machine-identity";
import { configureTravelMachine } from "./travel-machine";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("configuration Travel du Portable", () => {
  it("crée une identité reader même si la préférence d’environnement est writer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tk-travel-machine-"));
    temporary.push(root);
    const config: PortabilityConfig = {
      enabled: true,
      machineName: "Portable",
      rolePreference: "writer",
      statePath: path.join(root, "state"),
      backupPath: path.join(root, "backups"),
      stabilityWindowSeconds: 0,
      writerLeaseMinutes: 60,
      backupRetentionCount: 10,
    };

    const result = await configureTravelMachine(config, "Portable");

    expect(result).toMatchObject({ configured: true, created: true, identity: { displayName: "Portable", rolePreference: "reader" } });
  });

  it("réutilise seulement une identité reader existante", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tk-travel-machine-"));
    temporary.push(root);
    const config: PortabilityConfig = {
      enabled: true,
      machineName: "Portable",
      rolePreference: "reader",
      statePath: path.join(root, "state"),
      backupPath: path.join(root, "backups"),
      stabilityWindowSeconds: 0,
      writerLeaseMinutes: 60,
      backupRetentionCount: 10,
    };
    const prior = await ensureMachineIdentity(config, {
      displayName: "Portable existant",
      rolePreference: "reader",
      machineId: "11111111-1111-4111-8111-111111111111",
    });

    const result = await configureTravelMachine(config, "Portable renommé");

    expect(result).toEqual({ configured: true, created: false, identity: prior });
  });

  it("refuse et préserve une identité writer existante", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tk-travel-machine-"));
    temporary.push(root);
    const config: PortabilityConfig = {
      enabled: true,
      machineName: "Portable",
      rolePreference: "writer",
      statePath: path.join(root, "state"),
      backupPath: path.join(root, "backups"),
      stabilityWindowSeconds: 0,
      writerLeaseMinutes: 60,
      backupRetentionCount: 10,
    };
    const prior = await ensureMachineIdentity(config, {
      displayName: "Identité existante",
      rolePreference: "writer",
      machineId: "22222222-2222-4222-8222-222222222222",
    });

    await expect(configureTravelMachine(config, "Portable")).rejects.toThrow("n’est pas reader");
    await expect(loadMachineIdentity(config)).resolves.toEqual(prior);
  });
});

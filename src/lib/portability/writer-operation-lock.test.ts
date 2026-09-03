import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { getPortabilityConfig } from "./config";
import { PORTABILITY_LIMITS } from "./constants";
import { localProcessOwner } from "./process-instance";
import { acquireWriterOperationLock, writerOperationLockDirectory, writerOperationLockPath } from "./writer-operation-lock";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-writer-operation-lock-"));
  roots.push(root);
  const config = getPortabilityConfig({ TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state") });
  return { root, config };
}

async function writeTicket(
  directory: string,
  operationId: string,
  owner: { hostId: string; processId: number; processInstanceId: string },
): Promise<string> {
  const token = randomUUID();
  const target = path.join(directory, `${token}.ticket.json`);
  await mkdir(directory, { recursive: true });
  await writeFile(target, `${JSON.stringify({ schemaVersion: 2, token, operationId, ...owner, createdAt: new Date().toISOString(), phase: "ticket", ticket: 1 })}\n`);
  return target;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("verrou local des opérations writer", () => {
  it("reprend immédiatement la même opération après un crash local confirmé", async () => {
    const { config } = await fixture();
    const directory = writerOperationLockDirectory(config);
    const operationId = randomUUID();
    const token = randomUUID();
    const processInstanceId = randomUUID();
    const script = [
      "const fs=require('node:fs'),os=require('node:os'),path=require('node:path');",
      "const owner={hostId:process.env.TK_TEST_HOST_ID,processId:process.pid,processInstanceId:process.env.TK_TEST_PROCESS_INSTANCE_ID};",
      "const ticket={schemaVersion:2,token:process.env.TK_TEST_TOKEN,operationId:process.env.TK_TEST_OPERATION_ID,...owner,createdAt:new Date().toISOString(),phase:'ticket',ticket:1};",
      "fs.mkdirSync(process.env.TK_TEST_LOCK_DIRECTORY,{recursive:true});",
      "fs.writeFileSync(path.join(process.env.TK_TEST_LOCK_DIRECTORY,`${ticket.token}.ticket.json`),JSON.stringify(ticket));",
      "const marker=path.join(os.tmpdir(),'TubeKnowledge','portability','process-instances',owner.hostId,`${owner.processId}-${owner.processInstanceId}.json`);",
      "fs.mkdirSync(path.dirname(marker),{recursive:true});fs.writeFileSync(marker,JSON.stringify({schemaVersion:1,...owner,createdAt:new Date().toISOString()}));console.log(marker);",
    ].join("");
    const child = await execFileAsync(process.execPath, ["-e", script], { env: {
      ...process.env,
      TK_TEST_HOST_ID: localProcessOwner().hostId,
      TK_TEST_PROCESS_INSTANCE_ID: processInstanceId,
      TK_TEST_TOKEN: token,
      TK_TEST_OPERATION_ID: operationId,
      TK_TEST_LOCK_DIRECTORY: directory,
    } });

    const abandonedTicket = path.join(directory, `${token}.ticket.json`);
    let removals = 0;
    const remove = (async (candidate: string) => {
      if (candidate === abandonedTicket && removals++ === 0) throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
      return rm(candidate, { force: true });
    }) as typeof rm;
    let waited = false;
    const lock = await acquireWriterOperationLock(config, operationId, async (milliseconds) => { if (milliseconds === 25) waited = true; }, { remove });
    expect(waited).toBe(false);
    expect(removals).toBe(2);
    expect((await readdir(directory)).filter((name) => name.endsWith(".ticket.json"))).toHaveLength(1);
    await lock.release();
    await rm(child.stdout.trim(), { force: true });
  });

  it.each([
    { label: "owner étranger", owner: () => ({ hostId: "e".repeat(64), processId: 1234, processInstanceId: randomUUID() }) },
    { label: "PID local réutilisé", owner: () => ({ ...localProcessOwner(), processInstanceId: randomUUID() }) },
  ])("reste fail-closed pour un $label puis récupère après le TTL", async ({ owner }) => {
    const { config } = await fixture();
    const directory = writerOperationLockDirectory(config);
    const target = await writeTicket(directory, randomUUID(), owner());
    let waited = false;
    const lock = await acquireWriterOperationLock(config, randomUUID(), async () => {
      waited = true;
      const expired = new Date(Date.now() - PORTABILITY_LIMITS.writerBootstrapLockStaleMs - 1_000);
      await utimes(target, expired, expired);
    });
    expect(waited).toBe(true);
    await lock.release();
  });

  it("conserve un verrou fixe V1 fail-closed jusqu’au TTL puis le retire", async () => {
    const { config } = await fixture();
    const legacyPath = writerOperationLockPath(config);
    await mkdir(path.dirname(legacyPath), { recursive: true });
    await writeFile(legacyPath, JSON.stringify({ token: randomUUID(), operationId: randomUUID(), createdAt: new Date().toISOString() }));
    let waited = false;
    const lock = await acquireWriterOperationLock(config, randomUUID(), async () => {
      waited = true;
      const expired = new Date(Date.now() - PORTABILITY_LIMITS.writerBootstrapLockStaleMs - 1_000);
      await utimes(legacyPath, expired, expired);
    });
    expect(waited).toBe(true);
    await lock.release();
  });

  it("retente un EPERM transitoire et continue seulement après disparition confirmée", async () => {
    const { config } = await fixture();
    const directory = writerOperationLockDirectory(config);
    const target = await writeTicket(directory, randomUUID(), { ...localProcessOwner(), processId: 2_147_483_647, processInstanceId: randomUUID() });
    let removals = 0;
    const remove = (async (candidate: string) => {
      if (candidate === target && removals++ === 0) throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
      return rm(candidate, { force: true });
    }) as typeof rm;
    const lock = await acquireWriterOperationLock(config, randomUUID(), async () => undefined, { remove });
    expect(removals).toBe(2);
    await lock.release();
  });

  it("reste fail-closed après quatre EBUSY si le ticket est toujours présent", async () => {
    const { config } = await fixture();
    const directory = writerOperationLockDirectory(config);
    const target = await writeTicket(directory, randomUUID(), { ...localProcessOwner(), processId: 2_147_483_647, processInstanceId: randomUUID() });
    let removals = 0;
    const remove = (async (candidate: string) => {
      if (candidate === target) {
        removals += 1;
        throw Object.assign(new Error("sharing violation"), { code: "EBUSY" });
      }
      return rm(candidate, { force: true });
    }) as typeof rm;
    await expect(acquireWriterOperationLock(config, randomUUID(), async () => undefined, { remove })).rejects.toMatchObject({ code: "PORTABILITY_STATE_INCONSISTENT" });
    expect(removals).toBe(4);
    expect((await readdir(directory))).toContain(path.basename(target));
  });

  it("refuse une feuille ticket signalée comme symlink avant toute lecture", async () => {
    const { config } = await fixture();
    const directory = writerOperationLockDirectory(config);
    const target = await writeTicket(directory, randomUUID(), { ...localProcessOwner(), processId: 2_147_483_647, processInstanceId: randomUUID() });
    const readTargets: string[] = [];
    const lstatWithSymlinkLeaf = (async (candidate: string) => {
      const details = await lstat(candidate);
      if (candidate !== target) return details;
      return { ...details, isFile: () => false, isSymbolicLink: () => true } as typeof details;
    }) as typeof lstat;
    const readFile = (async (handle, candidate) => {
      readTargets.push(candidate);
      return handle.readFile("utf8");
    }) satisfies import("./writer-operation-lock").WriterOperationLockFileOperations["readFile"];

    await expect(acquireWriterOperationLock(config, randomUUID(), async () => undefined, {
      lstat: lstatWithSymlinkLeaf,
      readFile,
    })).rejects.toMatchObject({ code: "PORTABILITY_STATE_INCONSISTENT" });
    expect(readTargets).not.toContain(target);
  });

  it("retente un EPERM de lstat puis continue après disparition confirmée", async () => {
    const { config } = await fixture();
    const directory = writerOperationLockDirectory(config);
    const target = await writeTicket(directory, randomUUID(), { ...localProcessOwner(), processId: 2_147_483_647, processInstanceId: randomUUID() });
    let lstatAttempts = 0;
    let waited = false;
    const lstatWithTransientFailure = (async (candidate: string) => {
      if (candidate === target && lstatAttempts++ === 0) throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
      return lstat(candidate);
    }) as typeof lstat;
    const lock = await acquireWriterOperationLock(config, randomUUID(), async () => {
      waited = true;
      await rm(target, { force: true });
    }, { lstat: lstatWithTransientFailure });
    expect(waited).toBe(true);
    expect(lstatAttempts).toBeGreaterThanOrEqual(2);
    await lock.release();
  });
});

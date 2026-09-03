import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readFile as fsReadFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PORTABILITY_LIMITS } from "./constants";
import { localProcessOwner } from "./process-instance";
import { acquireSharedWriterTransitionClaim, sharedWriterTransitionClaimPath } from "./writer-transition-claim";

const roots: string[] = [];
const machineA = "11111111-1111-4111-8111-111111111111";
const machineB = "22222222-2222-4222-8222-222222222222";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-writer-transition-claim-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("claim partagé des transitions writer", () => {
  it("sérialise deux identités dans deux environnements visant le même vault local", async () => {
    const vault = await fixture();
    const first = await acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA);
    let waited = false;
    const second = acquireSharedWriterTransitionClaim(vault, randomUUID(), machineB, async () => {
      waited = true;
      await first.release();
    });

    const acquiredSecond = await second;
    expect(waited).toBe(true);
    expect((await readdir(sharedWriterTransitionClaimPath(vault))).filter((name) => name.endsWith(".ticket.json"))).toHaveLength(1);
    await acquiredSecond.release();
  });

  it("reprend la même opération après un crash dont le PID n’existe plus", async () => {
    const vault = await fixture();
    const directory = sharedWriterTransitionClaimPath(vault);
    const operationId = randomUUID();
    const abandonedToken = randomUUID();
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${abandonedToken}.ticket.json`), `${JSON.stringify({
      schemaVersion: 2,
      token: abandonedToken,
      operationId,
      machineId: machineA,
      hostId: localProcessOwner().hostId,
      processId: 2_147_483_647,
      processInstanceId: randomUUID(),
      createdAt: new Date().toISOString(),
      phase: "ticket",
      ticket: 1,
    })}\n`, "utf8");

    const resumed = await acquireSharedWriterTransitionClaim(vault, operationId, machineA);
    expect((await readdir(directory)).filter((name) => name.endsWith(".ticket.json"))).toHaveLength(1);
    await resumed.release();
    expect((await readdir(directory)).filter((name) => name.endsWith(".ticket.json"))).toEqual([]);
  });

  it.each([
    ".tubeknowledge",
    ".tubeknowledge/portability",
    ".tubeknowledge/portability/writer-transition-claims",
  ])("refuse un junction sortant du vault sur l’ancêtre %s avant toute écriture", async (relativeLink) => {
    const root = await fixture();
    const vault = path.join(root, "vault");
    const outside = path.join(root, "outside");
    const link = path.join(vault, ...relativeLink.split("/"));
    await mkdir(path.dirname(link), { recursive: true });
    await mkdir(outside);
    await symlink(outside, link, "junction");

    await expect(acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA)).rejects.toMatchObject({ code: "PORTABILITY_STATE_INCONSISTENT" });
    expect(await readdir(outside)).toEqual([]);
  });

  it("refuse par seam une feuille signalée comme symlink sans lire sa cible", async () => {
    const vault = await fixture();
    const directory = sharedWriterTransitionClaimPath(vault);
    const token = randomUUID();
    const target = path.join(directory, `${token}.ticket.json`);
    await mkdir(directory, { recursive: true });
    await writeFile(target, `${JSON.stringify({ schemaVersion: 1, token, operationId: randomUUID(), machineId: machineB, processId: process.pid, createdAt: new Date().toISOString(), phase: "ticket", ticket: 1 })}\n`);
    const readTargets: string[] = [];
    const lstatWithSymlinkLeaf = (async (candidate: string) => {
      const details = await lstat(candidate);
      if (candidate !== target) return details;
      return { ...details, isFile: () => false, isSymbolicLink: () => true } as typeof details;
    }) as typeof lstat;
    const readFile = (async (handle, candidate) => {
      readTargets.push(candidate);
      return handle.readFile("utf8");
    }) satisfies import("./writer-transition-claim").WriterTransitionClaimFileOperations["readFile"];

    await expect(acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA, async () => undefined, {
      lstat: lstatWithSymlinkLeaf,
      readFile,
    })).rejects.toMatchObject({ code: "PORTABILITY_STATE_INCONSISTENT" });
    expect(readTargets).not.toContain(target);
  });

  it("refuse un nom de feuille non UUID avant lstat et lecture", async () => {
    const vault = await fixture();
    const directory = sharedWriterTransitionClaimPath(vault);
    const target = path.join(directory, "not-a-uuid.ticket.json");
    await mkdir(directory, { recursive: true });
    await writeFile(target, "contenu qui ne doit pas être inspecté\n");
    const inspectedTargets: string[] = [];
    const readTargets: string[] = [];
    const trackedLstat = (async (candidate: string) => {
      inspectedTargets.push(candidate);
      return lstat(candidate);
    }) as typeof lstat;
    const readFile = (async (handle, candidate) => {
      readTargets.push(candidate);
      return handle.readFile("utf8");
    }) satisfies import("./writer-transition-claim").WriterTransitionClaimFileOperations["readFile"];

    await expect(acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA, async () => undefined, {
      lstat: trackedLstat,
      readFile,
    })).rejects.toMatchObject({ code: "PORTABILITY_STATE_INCONSISTENT" });
    expect(inspectedTargets).not.toContain(target);
    expect(readTargets).not.toContain(target);
  });

  it("refuse une vraie feuille symlink sans altérer la cible externe", async (context) => {
    const root = await fixture();
    const vault = path.join(root, "vault");
    const directory = sharedWriterTransitionClaimPath(vault);
    const outside = path.join(root, "outside-claim.json");
    const token = randomUUID();
    const target = path.join(directory, `${token}.ticket.json`);
    const externalContent = `${JSON.stringify({ schemaVersion: 1, token, operationId: randomUUID(), machineId: machineB, processId: process.pid, createdAt: new Date().toISOString(), phase: "ticket", ticket: 1 })}\n`;
    await mkdir(directory, { recursive: true });
    await writeFile(outside, externalContent);
    try {
      await symlink(outside, target, "file");
    } catch (error) {
      if (process.platform === "win32" && ["EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code || "")) {
        context.skip();
        return;
      }
      throw error;
    }

    await expect(acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA)).rejects.toMatchObject({ code: "PORTABILITY_STATE_INCONSISTENT" });
    expect(await fsReadFile(outside, "utf8")).toBe(externalContent);
  });

  it.skipIf(process.platform !== "win32")("accepte l’identité inode quand path et handle exposent des volumes différents", async () => {
    const vault = await fixture();
    const acquired = await acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA);
    const directory = sharedWriterTransitionClaimPath(vault);
    const ticketName = (await readdir(directory)).find((name) => name.endsWith(".ticket.json"));
    expect(ticketName).toBeDefined();
    const target = path.join(directory, ticketName!);
    const pathDetails = await lstat(target);
    const handle = await open(target, "r");
    const handleDetails = await handle.stat();
    await handle.close();
    expect(pathDetails.ino).toBe(handleDetails.ino);
    expect(pathDetails.dev).not.toBe(handleDetails.dev);
    await acquired.release();
  });

  it.each([
    { label: "host étranger", owner: () => ({ hostId: "f".repeat(64), processId: 1234, processInstanceId: randomUUID() }) },
    { label: "PID local réutilisé", owner: () => ({ ...localProcessOwner(), processInstanceId: randomUUID() }) },
  ])("garde un claim $label fermé puis le libère après le TTL borné", async ({ owner }) => {
    const vault = await fixture();
    const directory = sharedWriterTransitionClaimPath(vault);
    const token = randomUUID();
    const target = path.join(directory, `${token}.ticket.json`);
    await mkdir(directory, { recursive: true });
    await writeFile(target, `${JSON.stringify({ schemaVersion: 2, token, operationId: randomUUID(), machineId: machineB, ...owner(), createdAt: new Date().toISOString(), phase: "ticket", ticket: 1 })}\n`);
    let waited = false;

    const acquired = await acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA, async () => {
      waited = true;
      const expired = new Date(Date.now() - PORTABILITY_LIMITS.sharedWriterTransitionClaimStaleMs - 1_000);
      await utimes(target, expired, expired);
    });
    expect(waited).toBe(true);
    await acquired.release();
  });

  it("conserve un claim schemaVersion 1 fail-closed jusqu’au TTL", async () => {
    const vault = await fixture();
    const directory = sharedWriterTransitionClaimPath(vault);
    const token = randomUUID();
    const target = path.join(directory, `${token}.ticket.json`);
    await mkdir(directory, { recursive: true });
    await writeFile(target, `${JSON.stringify({ schemaVersion: 1, token, operationId: randomUUID(), machineId: machineB, processId: process.pid, createdAt: new Date().toISOString(), phase: "ticket", ticket: 1 })}\n`);
    let waited = false;
    const acquired = await acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA, async () => {
      waited = true;
      const expired = new Date(Date.now() - PORTABILITY_LIMITS.sharedWriterTransitionClaimStaleMs - 1_000);
      await utimes(target, expired, expired);
    });
    expect(waited).toBe(true);
    await acquired.release();
  });

  it("retente un EPERM transitoire avant de confirmer la disparition du claim", async () => {
    const vault = await fixture();
    const directory = sharedWriterTransitionClaimPath(vault);
    const token = randomUUID();
    const target = path.join(directory, `${token}.ticket.json`);
    await mkdir(directory, { recursive: true });
    await writeFile(target, `${JSON.stringify({ schemaVersion: 2, token, operationId: randomUUID(), machineId: machineB, ...localProcessOwner(), processId: 2_147_483_647, processInstanceId: randomUUID(), createdAt: new Date().toISOString(), phase: "ticket", ticket: 1 })}\n`);
    let removals = 0;
    const remove = (async (candidate: string) => {
      if (candidate === target && removals++ === 0) throw Object.assign(new Error("sharing violation"), { code: "EPERM" });
      return rm(candidate, { force: true });
    }) as typeof rm;
    const acquired = await acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA, async () => undefined, { remove });
    expect(removals).toBe(2);
    await acquired.release();
  });

  it("accepte une disparition concurrente entre la revalidation du jeton et rm", async () => {
    const vault = await fixture();
    const directory = sharedWriterTransitionClaimPath(vault);
    const token = randomUUID();
    const target = path.join(directory, `${token}.ticket.json`);
    await mkdir(directory, { recursive: true });
    await writeFile(target, `${JSON.stringify({ schemaVersion: 2, token, operationId: randomUUID(), machineId: machineB, ...localProcessOwner(), processId: 2_147_483_647, processInstanceId: randomUUID(), createdAt: new Date().toISOString(), phase: "ticket", ticket: 1 })}\n`);
    let disappearedConcurrently = false;
    const remove = (async (candidate: string) => {
      if (candidate === target && !disappearedConcurrently) {
        disappearedConcurrently = true;
        await rm(candidate);
      }
      return rm(candidate);
    }) as typeof rm;

    const acquired = await acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA, async () => undefined, { remove });
    expect(disappearedConcurrently).toBe(true);
    await acquired.release();
  });

  it("reste fail-closed après quatre EBUSY si le claim persiste", async () => {
    const vault = await fixture();
    const directory = sharedWriterTransitionClaimPath(vault);
    const token = randomUUID();
    const target = path.join(directory, `${token}.ticket.json`);
    await mkdir(directory, { recursive: true });
    await writeFile(target, `${JSON.stringify({ schemaVersion: 2, token, operationId: randomUUID(), machineId: machineB, ...localProcessOwner(), processId: 2_147_483_647, processInstanceId: randomUUID(), createdAt: new Date().toISOString(), phase: "ticket", ticket: 1 })}\n`);
    let removals = 0;
    const remove = (async (candidate: string) => {
      if (candidate === target) {
        removals += 1;
        throw Object.assign(new Error("sharing violation"), { code: "EBUSY" });
      }
      return rm(candidate, { force: true });
    }) as typeof rm;
    await expect(acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA, async () => undefined, { remove })).rejects.toMatchObject({ code: "PORTABILITY_STATE_INCONSISTENT" });
    expect(removals).toBe(4);
    expect(await readdir(directory)).toContain(path.basename(target));
  });

  it("reste fail-closed après quatre EBUSY de lecture si le claim persiste", async () => {
    const vault = await fixture();
    const directory = sharedWriterTransitionClaimPath(vault);
    const token = randomUUID();
    const target = path.join(directory, `${token}.ticket.json`);
    await mkdir(directory, { recursive: true });
    await writeFile(target, `${JSON.stringify({ schemaVersion: 2, token, operationId: randomUUID(), machineId: machineB, ...localProcessOwner(), processId: 2_147_483_647, processInstanceId: randomUUID(), createdAt: new Date().toISOString(), phase: "ticket", ticket: 1 })}\n`);
    let reads = 0;
    const readFile = (async (handle, candidate) => {
      if (candidate === target) {
        reads += 1;
        throw Object.assign(new Error("sharing violation"), { code: "EBUSY" });
      }
      return handle.readFile("utf8");
    }) satisfies import("./writer-transition-claim").WriterTransitionClaimFileOperations["readFile"];
    await expect(acquireSharedWriterTransitionClaim(vault, randomUUID(), machineA, async () => undefined, { readFile })).rejects.toMatchObject({ code: "PORTABILITY_STATE_INCONSISTENT" });
    expect(reads).toBe(4);
    expect(await readdir(directory)).toContain(path.basename(target));
  });
});

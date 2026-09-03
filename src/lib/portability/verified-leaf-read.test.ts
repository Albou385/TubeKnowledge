import type { BigIntStats } from "node:fs";
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readVerifiedRegularLeaf, type VerifiedLeafReadOperations } from "./verified-leaf-read";

const roots: string[] = [];

async function fixture(): Promise<{ directory: string; target: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tk-verified-leaf-"));
  roots.push(directory);
  const target = path.join(directory, "claim.json");
  await writeFile(target, "trusted-on-disk\n");
  return { directory, target };
}

function withInode(details: BigIntStats, inode: bigint): BigIntStats {
  return {
    ...details,
    ino: inode,
    isFile: () => details.isFile(),
    isSymbolicLink: () => details.isSymbolicLink(),
  } as BigIntStats;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("lecture bornée d’une feuille vérifiée", () => {
  it("jette le contenu si la feuille disparaît après lecture puis confirme son absence", async () => {
    const { directory, target } = await fixture();
    let reads = 0;
    const readFile = (async (_handle, candidate) => {
      reads += 1;
      await rm(candidate);
      return "contenu-hostile-à-jeter";
    }) satisfies VerifiedLeafReadOperations["readFile"];

    const result = await readVerifiedRegularLeaf(directory, target, async () => undefined, async () => undefined, { readFile });
    expect(result).toBeNull();
    expect(reads).toBe(1);
  });

  it("jette un premier contenu si l’inode change puis retourne seulement le cycle revalidé", async () => {
    const { directory, target } = await fixture();
    let identityReads = 0;
    let contentReads = 0;
    const lstatBigInt = async (candidate: string) => {
      const details = await lstat(candidate, { bigint: true });
      if (candidate === target && ++identityReads === 3) return withInode(details, details.ino + BigInt("1"));
      return details;
    };
    const readFile = (async () => (++contentReads === 1 ? "contenu-hostile-à-jeter" : "contenu-revalidé")) satisfies VerifiedLeafReadOperations["readFile"];

    const result = await readVerifiedRegularLeaf(directory, target, async () => undefined, async () => undefined, { lstatBigInt, readFile });
    expect(result?.content).toBe("contenu-revalidé");
    expect(contentReads).toBe(2);
  });

  it("reste fail-closed si l’inode change après chaque lecture jusqu’à la borne", async () => {
    const { directory, target } = await fixture();
    let identityReads = 0;
    let contentReads = 0;
    const lstatBigInt = async (candidate: string) => {
      const details = await lstat(candidate, { bigint: true });
      identityReads += 1;
      if (candidate === target && identityReads % 3 === 0) return withInode(details, details.ino + BigInt("1"));
      return details;
    };
    const readFile = (async () => {
      contentReads += 1;
      return `contenu-hostile-${contentReads}`;
    }) satisfies VerifiedLeafReadOperations["readFile"];

    await expect(readVerifiedRegularLeaf(directory, target, async () => undefined, async () => undefined, { lstatBigInt, readFile }))
      .rejects.toMatchObject({ code: "PORTABILITY_STATE_INCONSISTENT" });
    expect(contentReads).toBe(4);
  });

  it("refuse immédiatement un inode nul sans lire de contenu", async () => {
    const { directory, target } = await fixture();
    let contentReads = 0;
    const lstatBigInt = async (candidate: string) => {
      const details = await lstat(candidate, { bigint: true });
      return candidate === target ? withInode(details, details.ino - details.ino) : details;
    };
    const readFile = (async () => {
      contentReads += 1;
      return "contenu-hostile";
    }) satisfies VerifiedLeafReadOperations["readFile"];

    await expect(readVerifiedRegularLeaf(directory, target, async () => undefined, async () => undefined, { lstatBigInt, readFile }))
      .rejects.toMatchObject({ code: "PORTABILITY_STATE_INCONSISTENT" });
    expect(contentReads).toBe(0);
  });
});

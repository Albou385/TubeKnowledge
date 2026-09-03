import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

async function productionSources(root: string): Promise<string> {
  const chunks: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) chunks.push(await readFile(target, "utf8"));
    }
  }
  await visit(root);
  return chunks.join("\n");
}

describe("frontière d’écriture du parcours principal", () => {
  it.each(["src/lib/workflows", "src/lib/analysis-providers", "src/lib/library-assistant"])("interdit tout appel direct à Apply depuis %s", async (directory) => {
    const source = await productionSources(directory);
    expect(source).not.toMatch(/from\s+["']@\/lib\/imports\/apply["']/);
    expect(source).not.toMatch(/\bapplyImport\s*\(/);
  });

  it("conserve gate, revalidation, backup et vérification finale dans le bon ordre", async () => {
    const source = await readFile("src/lib/imports/apply.ts", "utf8");
    const body = source.slice(source.indexOf("export async function applyImport"));
    const gates = [...body.matchAll(/await assertPortabilityWriteAllowed/g)].map((match) => match.index!);
    const revalidations = [...body.matchAll(/await revalidate/g)].map((match) => match.index!);
    const backup = body.indexOf("backup = await createBackup");
    const write = body.indexOf("await atomicWrite(target, operation.content)");
    const finalHash = body.indexOf("const finalHash = sha256(await readFile(target))");
    expect(gates).toHaveLength(2);
    expect(revalidations).toHaveLength(2);
    expect(gates[0]).toBeLessThan(backup);
    expect(backup).toBeLessThan(revalidations[1]);
    expect(revalidations[1]).toBeLessThan(gates[1]);
    expect(gates[1]).toBeLessThan(write);
    expect(write).toBeLessThan(finalHash);
  });
});

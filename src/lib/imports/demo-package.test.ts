import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEMO_CREATE_PATH,
  DEMO_REPLACE_PATH,
  generateDemoPackage,
  parseVaultArgument,
} from "../../../scripts/generate-phase3-demo-package";
import { parseImportZip } from "@/lib/imports/archive";
import { sha256 } from "@/lib/imports/hash";
import { previewImport } from "@/lib/imports/preview";

describe("générateur du paquet de démonstration Phase 3", () => {
  let temporaryRoot: string;
  let vaultPath: string;
  let outputPath: string;
  let sessionRoot: string;
  const originalVideos = "# Vidéos traitées\n\n| Titre | URL | Sections touchées | Statut |\n|---|---|---|---|\n";

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "tk-demo-package-"));
    vaultPath = path.join(temporaryRoot, "staging-vault");
    outputPath = path.join(temporaryRoot, "output", "demo.zip");
    sessionRoot = path.join(temporaryRoot, "sessions");
    await mkdir(path.join(vaultPath, "02_SOURCES"), { recursive: true });
    await writeFile(path.join(vaultPath, "INDEX.md"), "# Index staging\n", "utf8");
    await writeFile(path.join(vaultPath, "02_SOURCES", "videos.md"), originalVideos, "utf8");
  });

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  async function generate() {
    return generateDemoPackage({
      vaultPath,
      outputPath,
      workingDirectory: temporaryRoot,
      environment: {},
      now: new Date("2026-07-21T23:00:00.000Z"),
      packageId: "123e4567-e89b-42d3-a456-426614174222",
    });
  }

  it("génère un ZIP valide avec les deux opérations demandées", async () => {
    const result = await generate();
    expect((await stat(result.zipPath)).isFile()).toBe(true);
    expect(result.operations).toEqual([DEMO_CREATE_PATH, DEMO_REPLACE_PATH]);
    const parsed = await parseImportZip(await readFile(result.zipPath));
    expect(parsed.manifest).toMatchObject({
      schemaVersion: 1,
      packageId: "123e4567-e89b-42d3-a456-426614174222",
      generatedAt: "2026-07-21T23:00:00.000Z",
      operations: [{ type: "create", path: DEMO_CREATE_PATH }, { type: "replace", path: DEMO_REPLACE_PATH }],
    });
  });

  it("calcule les hashes exacts de l’ancien et du nouveau contenu", async () => {
    const result = await generate();
    const parsed = await parseImportZip(await readFile(result.zipPath));
    const createOperation = parsed.manifest.operations[0];
    const replaceOperation = parsed.manifest.operations[1];
    const createContent = parsed.contents.get(createOperation.contentFile)!;
    const newVideos = parsed.contents.get(replaceOperation.contentFile)!;
    expect(createOperation.newSha256).toBe(sha256(createContent));
    expect(replaceOperation.type).toBe("replace");
    if (replaceOperation.type === "replace") expect(replaceOperation.expectedSha256).toBe(sha256(originalVideos));
    expect(replaceOperation.newSha256).toBe(sha256(newVideos));
    expect(newVideos).toContain("Démonstration Phase 3 — ne pas conserver");
    expect(result.originalVideosSha256).toBe(sha256(originalVideos));
  });

  it("refuse le vault configuré et le motif du vault réel", async () => {
    await expect(generateDemoPackage({ vaultPath, outputPath, workingDirectory: temporaryRoot, environment: { YOUTUBE_LIBRARY_PATH: vaultPath } })).rejects.toThrow("YOUTUBE_LIBRARY_PATH");
    await expect(generateDemoPackage({ vaultPath: "C:\\Users\\personne\\OneDrive\\projet_youtube", outputPath, workingDirectory: temporaryRoot, environment: {} })).rejects.toThrow("vault réel");
    await writeFile(path.join(temporaryRoot, ".env.local"), `YOUTUBE_LIBRARY_PATH=${vaultPath}\n`, "utf8");
    await expect(generateDemoPackage({ vaultPath, outputPath, workingDirectory: temporaryRoot, environment: {} })).rejects.toThrow("YOUTUBE_LIBRARY_PATH");
  });

  it("ne modifie aucun fichier du vault de staging", async () => {
    const videosPath = path.join(vaultPath, "02_SOURCES", "videos.md");
    const before = await stat(videosPath);
    await generate();
    const after = await stat(videosPath);
    expect(await readFile(videosPath, "utf8")).toBe(originalVideos);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    await expect(stat(path.join(vaultPath, ...DEMO_CREATE_PATH.split("/")))).rejects.toThrow();
  });

  it("produit un paquet accepté par Preview", async () => {
    const result = await generate();
    const preview = await previewImport(await readFile(result.zipPath), {
      environment: { YOUTUBE_LIBRARY_PATH: vaultPath },
      sessionRoot,
    });
    expect(preview.canApply).toBe(true);
    expect(preview.operations).toMatchObject([
      { type: "create", path: DEMO_CREATE_PATH, status: "valid" },
      { type: "replace", path: DEMO_REPLACE_PATH, status: "valid" },
    ]);
  });

  it("exige un argument --vault explicite", () => {
    expect(() => parseVaultArgument([])).toThrow("--vault");
    expect(parseVaultArgument(["--vault", vaultPath])).toBe(vaultPath);
  });
});

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildLibraryTree,
  inspectLibrary,
  isIgnoredEntry,
  readMarkdownDocument,
} from "@/lib/library/library-reader";

describe("lecture de la bibliothèque", () => {
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await mkdtemp(path.join(os.tmpdir(), "tubeknowledge-"));
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  it("filtre les dossiers techniques et les éléments cachés", () => {
    expect(isIgnoredEntry(".obsidian")).toBe(true);
    expect(isIgnoredEntry(".git")).toBe(true);
    expect(isIgnoredEntry(".backups")).toBe(true);
    expect(isIgnoredEntry("node_modules")).toBe(true);
    expect(isIgnoredEntry(".note.md")).toBe(true);
    expect(isIgnoredEntry("01_BIBLIOTHEQUE")).toBe(false);
  });

  it("lit INDEX.md en UTF-8", async () => {
    await writeFile(path.join(rootPath, "INDEX.md"), "# Index\n\nRésumé en français.", "utf8");
    const document = await readMarkdownDocument("INDEX.md", {
      YOUTUBE_LIBRARY_PATH: rootPath,
    });

    expect(document.title).toBe("Index");
    expect(document.content).toContain("Résumé en français");
    expect(document.wordCount).toBe(4);
    expect(document.section).toBe("Racine");
    expect(document.lastModified).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("génère une arborescence récursive de fichiers Markdown", async () => {
    await mkdir(path.join(rootPath, "01_BIBLIOTHEQUE", "sujet"), { recursive: true });
    await writeFile(path.join(rootPath, "INDEX.md"), "# Index", "utf8");
    await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "note.md"), "# Note", "utf8");
    await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "ignore.txt"), "non", "utf8");
    await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "sujet", "detail.md"), "# Détail", "utf8");

    const tree = await buildLibraryTree(rootPath);
    expect(tree).toEqual([
      {
        type: "directory",
        name: "01_BIBLIOTHEQUE",
        relativePath: "01_BIBLIOTHEQUE",
        children: [
          {
            type: "directory",
            name: "sujet",
            relativePath: "01_BIBLIOTHEQUE/sujet",
            children: [
              {
                type: "file",
                name: "detail.md",
                relativePath: "01_BIBLIOTHEQUE/sujet/detail.md",
              },
            ],
          },
          {
            type: "file",
            name: "note.md",
            relativePath: "01_BIBLIOTHEQUE/note.md",
          },
        ],
      },
      { type: "file", name: "INDEX.md", relativePath: "INDEX.md" },
    ]);
  });

  it("signale un dossier inexistant sans planter", async () => {
    const snapshot = await inspectLibrary({
      YOUTUBE_LIBRARY_PATH: path.join(rootPath, "absent"),
    });
    expect(snapshot).toMatchObject({
      available: false,
      configValid: true,
      accessible: false,
      indexPresent: false,
    });
  });

  it("signale INDEX.md absent", async () => {
    const snapshot = await inspectLibrary({ YOUTUBE_LIBRARY_PATH: rootPath });
    expect(snapshot).toMatchObject({
      available: false,
      configValid: true,
      accessible: true,
      indexPresent: false,
    });
  });

  it("calcule les sections et le total Markdown", async () => {
    await mkdir(path.join(rootPath, "section"));
    await writeFile(path.join(rootPath, "INDEX.md"), "# Index", "utf8");
    await writeFile(path.join(rootPath, "section", "note.md"), "# Note", "utf8");

    const snapshot = await inspectLibrary({ YOUTUBE_LIBRARY_PATH: rootPath });
    expect(snapshot).toMatchObject({
      available: true,
      stats: { topLevelSections: 1, markdownFiles: 2 },
    });
  });

  it("ignore un lien symbolique au lieu de le suivre", async () => {
    await writeFile(path.join(rootPath, "INDEX.md"), "# Index", "utf8");
    const outsidePath = await mkdtemp(path.join(os.tmpdir(), "tubeknowledge-outside-"));
    try {
      await writeFile(path.join(outsidePath, "secret.md"), "# Secret", "utf8");
      await symlink(outsidePath, path.join(rootPath, "external"), "junction");
      const tree = await buildLibraryTree(rootPath);
      expect(tree.some((node) => node.name === "external")).toBe(false);
    } finally {
      await rm(outsidePath, { recursive: true, force: true });
    }
  });
});

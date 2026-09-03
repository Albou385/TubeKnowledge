import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getArtificialIntelligenceView } from "@/lib/artificial-intelligence/ai-view";

describe("vue Intelligence artificielle", () => {
  let rootPath: string;
  let environment: { YOUTUBE_LIBRARY_PATH: string };

  beforeEach(async () => {
    rootPath = await mkdtemp(path.join(os.tmpdir(), "tubeknowledge-ai-"));
    environment = { YOUTUBE_LIBRARY_PATH: rootPath };
    await mkdir(path.join(rootPath, "01_BIBLIOTHEQUE", "Intelligence-artificielle"), { recursive: true });
    await writeFile(path.join(rootPath, "INDEX.md"), "# Accueil", "utf8");
    await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Intelligence-artificielle", "INDEX.md"), "# Intelligence artificielle", "utf8");
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  it("gère une section sans fichier de notion", async () => {
    const view = await getArtificialIntelligenceView(environment);
    expect(view.index?.title).toBe("Intelligence artificielle");
    expect(view.notions).toEqual([]);
    expect(view.subsections).toEqual([]);
  });

  it("présente les sous-sections et fichiers réellement présents", async () => {
    const subsection = path.join(rootPath, "01_BIBLIOTHEQUE", "Intelligence-artificielle", "Fondations");
    await mkdir(subsection);
    await writeFile(path.join(subsection, "modeles.md"), "# Modèles\n\nNotion réelle.", "utf8");
    const view = await getArtificialIntelligenceView(environment);
    expect(view.subsections).toEqual([
      { name: "Fondations", relativePath: "01_BIBLIOTHEQUE/Intelligence-artificielle/Fondations", documentCount: 1 },
    ]);
    expect(view.notions.map((document) => document.title)).toEqual(["Modèles"]);
    expect(view.recentDocuments).toHaveLength(2);
  });
});

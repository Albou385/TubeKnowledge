import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildLibraryTree } from "@/lib/library/library-reader";
import { getLibraryNavigation } from "@/lib/library/library-navigation";

describe("navigation sémantique de la bibliothèque", () => {
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await (await import("node:fs/promises")).mkdtemp(path.join(os.tmpdir(), "tubeknowledge-library-navigation-"));
    await mkdir(path.join(rootPath, "01_BIBLIOTHEQUE", "Domaine", "Sujet"), { recursive: true });
    await writeFile(path.join(rootPath, "INDEX.md"), "# Index\n", "utf8");
    await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Domaine", "INDEX.md"), "# Domaine\n", "utf8");
    await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Domaine", "Sujet", "INDEX.md"), "# Sujet\n", "utf8");
    await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Domaine", "Sujet", "a.md"), "# A\n\nRésumé fiable de la notion A.\n\n## Sources vidéo\n- [Une source](https://example.test/a)\n\n## Liens\n[[b]]\n", "utf8");
    await writeFile(path.join(rootPath, "01_BIBLIOTHEQUE", "Domaine", "Sujet", "b.md"), "# B\n\n## Sources vidéo\nAucune URL vérifiable.\n", "utf8");
  });

  afterEach(async () => { await rm(rootPath, { recursive: true, force: true }); });

  it("dérive domaines, sujets, résumé, sources et relations explicites sans écrire", async () => {
    const navigation = await getLibraryNavigation(await buildLibraryTree(rootPath), { YOUTUBE_LIBRARY_PATH: rootPath });
    expect(navigation).toHaveLength(1);
    expect(navigation[0]).toMatchObject({ name: "Domaine", subjects: [{ name: "Sujet" }] });
    expect(navigation[0].subjects[0].notions).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "A", summary: "Résumé fiable de la notion A.", sourceCount: 1, relatedNotions: [expect.objectContaining({ title: "B" })] }),
      expect.objectContaining({ title: "B", summary: null, sourceCount: 0, relatedNotions: [expect.objectContaining({ title: "A" })] }),
    ]));
  });
});

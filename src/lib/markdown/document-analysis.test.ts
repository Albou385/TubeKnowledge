import { describe, expect, it } from "vitest";

import { countWords, extractHeadings, getMainSection, slugifyHeading } from "@/lib/markdown/document-analysis";

describe("analyse des documents Markdown", () => {
  it("extrait uniquement les titres h2 et h3 avec des ancres stables", () => {
    expect(extractHeadings("# Titre\n\n## Première notion\n### Détail\n## Première notion\n#### Ignoré")).toEqual([
      { level: 2, text: "Première notion", id: "premiere-notion" },
      { level: 3, text: "Détail", id: "detail" },
      { level: 2, text: "Première notion", id: "premiere-notion-2" },
    ]);
  });

  it("génère une ancre même pour un titre accentué ou sans caractères alphanumériques", () => {
    expect(slugifyHeading("Éthique & IA")).toBe("ethique-ia");
    expect(slugifyHeading("!!!")).toBe("section");
  });

  it("calcule un nombre approximatif de mots et la section principale", () => {
    expect(countWords("# Bonjour\n\nCeci est un **court** document d’aujourd’hui.")).toBe(7);
    expect(getMainSection("01_BIBLIOTHEQUE/IA/note.md")).toBe("01_BIBLIOTHEQUE");
    expect(getMainSection("INDEX.md")).toBe("Racine");
  });
});

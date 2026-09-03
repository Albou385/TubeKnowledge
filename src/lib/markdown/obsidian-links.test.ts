import { describe, expect, it } from "vitest";

import { convertObsidianLinks } from "@/lib/markdown/obsidian-links";

describe("convertObsidianLinks", () => {
  it("convertit un lien avec libellé en lien interne", () => {
    expect(convertObsidianLinks("Voir [[00_SYSTEME/ROADMAP|Roadmap]].")).toBe(
      "Voir [Roadmap](/library/00_SYSTEME/ROADMAP.md).",
    );
  });

  it("convertit un lien simple sans doubler l’extension", () => {
    expect(convertObsidianLinks("[[INDEX.md]]")).toBe("[INDEX.md](/library/INDEX.md)");
  });

  it("laisse les embeds avancés inchangés", () => {
    expect(convertObsidianLinks("![[image.png]]")).toBe("![[image.png]]");
  });
});

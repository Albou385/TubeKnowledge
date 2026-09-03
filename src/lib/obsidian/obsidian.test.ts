import { describe, expect, it } from "vitest";

import { buildObsidianUrl, getObsidianVaultName } from "@/lib/obsidian/obsidian";

describe("liens Obsidian", () => {
  it("encode le nom du vault et le chemin logique", () => {
    expect(buildObsidianUrl("Mon coffre", "01_BIBLIOTHEQUE/Notion spéciale.md")).toBe(
      "obsidian://open?vault=Mon%20coffre&file=01_BIBLIOTHEQUE%2FNotion%20sp%C3%A9ciale.md",
    );
  });

  it("retourne null lorsque le nom de vault n’est pas configuré", () => {
    expect(getObsidianVaultName({})).toBeNull();
    expect(buildObsidianUrl(null, "INDEX.md")).toBeNull();
  });

  it("conserve la protection contre les chemins dangereux", () => {
    expect(() => buildObsidianUrl("coffre", "../secret.md")).toThrow("segments");
    expect(() => buildObsidianUrl("coffre", "C:\\secret.md")).toThrow("absolus");
  });
});

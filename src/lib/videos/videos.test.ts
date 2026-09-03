import { describe, expect, it } from "vitest";

import { isSafeExternalUrl, parseVideosTable } from "@/lib/videos/videos";

describe("tableau des vidéos", () => {
  it("retourne un état vide pour le tableau actuel sans entrée", () => {
    expect(parseVideosTable("| Titre | URL | Sections touchées | Statut |\n|---|---|---|---|\n| _Aucune vidéo traitée_ | | | |")).toEqual([]);
  });

  it("lit une ligne vidéo valide", () => {
    expect(parseVideosTable("| Titre | URL | Sections touchées | Statut |\n|---|---|---|---|\n| Cours IA | https://youtu.be/abc | IA, Web | Terminé |")).toEqual([
      { title: "Cours IA", url: "https://youtu.be/abc", sections: ["IA", "Web"], status: "Terminé" },
    ]);
  });

  it("reste vide lorsqu’aucun tableau n’est présent", () => {
    expect(parseVideosTable("# Vidéos\n\nAucune donnée.")).toEqual([]);
  });

  it("accepte HTTP(S) et refuse les protocoles externes dangereux", () => {
    expect(isSafeExternalUrl("https://youtube.com/watch?v=1")).toBe(true);
    expect(isSafeExternalUrl("http://example.test/video")).toBe(true);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("file:///secret")).toBe(false);
  });
});

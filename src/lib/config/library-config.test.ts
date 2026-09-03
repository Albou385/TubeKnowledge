import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseLibraryConfig } from "@/lib/config/library-config";

describe("parseLibraryConfig", () => {
  it("accepte une configuration absolue valide", () => {
    const rootPath = path.resolve("fixtures", "library");
    expect(parseLibraryConfig({ YOUTUBE_LIBRARY_PATH: rootPath })).toEqual({
      ok: true,
      rootPath: path.normalize(rootPath),
    });
  });

  it("explique clairement une variable absente", () => {
    const result = parseLibraryConfig({ YOUTUBE_LIBRARY_PATH: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("YOUTUBE_LIBRARY_PATH");
    }
  });

  it("refuse un chemin de bibliothèque relatif", () => {
    expect(parseLibraryConfig({ YOUTUBE_LIBRARY_PATH: "notes/library" }).ok).toBe(false);
  });
});

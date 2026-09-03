import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  normalizeRelativeMarkdownPath,
  resolveInsideLibrary,
  UnsafeLibraryPathError,
} from "@/lib/library/path-security";

describe("sécurité des chemins", () => {
  it("normalise les séparateurs Windows et POSIX", () => {
    expect(normalizeRelativeMarkdownPath("00_SYSTEME\\ROADMAP.md")).toBe(
      "00_SYSTEME/ROADMAP.md",
    );
    expect(normalizeRelativeMarkdownPath("./00_SYSTEME/ROADMAP.md")).toBe(
      "00_SYSTEME/ROADMAP.md",
    );
  });

  it("rejette un segment parent", () => {
    expect(() => normalizeRelativeMarkdownPath("../secret.md")).toThrow(
      UnsafeLibraryPathError,
    );
  });

  it("rejette un chemin absolu Windows même sur un autre système", () => {
    expect(() => normalizeRelativeMarkdownPath("C:\\Users\\personne\\secret.md")).toThrow(
      "absolus",
    );
  });

  it("rejette un chemin absolu POSIX", () => {
    expect(() => normalizeRelativeMarkdownPath("/etc/secret.md")).toThrow("absolus");
  });

  it("rejette les extensions autres que Markdown", () => {
    expect(() => normalizeRelativeMarkdownPath("notes/video.txt")).toThrow("Markdown");
  });

  it("résout un document uniquement sous la racine", () => {
    const root = path.resolve("temporary-library");
    expect(resolveInsideLibrary(root, "notes/intro.md")).toBe(
      path.resolve(root, "notes", "intro.md"),
    );
  });
});

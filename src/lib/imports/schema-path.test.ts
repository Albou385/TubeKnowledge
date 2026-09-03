import { describe, expect, it } from "vitest";

import { IMPORT_LIMITS } from "@/lib/imports/constants";
import { isAllowedImportTarget, normalizeImportPath, validateManifestPaths } from "@/lib/imports/path-policy";
import { importManifestSchema } from "@/lib/imports/schema";
import { validManifest } from "@/lib/imports/test-utils";

describe("manifeste V1 et politique de chemins", () => {
  it("accepte le manifeste V1 valide", () => expect(importManifestSchema.parse(validManifest()).schemaVersion).toBe(1));
  it.each([
    ["version", { schemaVersion: 2 }], ["UUID", { packageId: "non-uuid" }], ["date", { generatedAt: "hier" }],
  ])("refuse %s invalide", (_label, override) => expect(() => importManifestSchema.parse({ ...validManifest(), ...override })).toThrow());
  it("refuse un type d’opération interdit", () => expect(() => importManifestSchema.parse({ ...validManifest(), operations: [{ type: "delete", path: "INDEX.md" }] })).toThrow());
  it("refuse plus de 50 opérations", () => expect(() => importManifestSchema.parse({ ...validManifest(), operations: Array.from({ length: IMPORT_LIMITS.maxOperations + 1 }, () => validManifest().operations[0]) })).toThrow());
  it.each(["INDEX.md", "00_SYSTEME/TAXONOMY.md", "00_SYSTEME/CHANGELOG.md", "01_BIBLIOTHEQUE/IA/note.md", "02_SOURCES/videos.md"])("autorise %s", (value) => expect(isAllowedImportTarget(value)).toBe(true));
  it.each(["00_SYSTEME/ROADMAP.md", "03_A_TRAITER/note.md", ".obsidian/x.md", ".backups/x.md", ".tubeknowledge/x.md"])("refuse %s", (value) => expect(isAllowedImportTarget(value)).toBe(false));
  it.each(["../secret.md", "/secret.md", "C:/secret.md", "note.txt", "a\\b.md"])("rejette le chemin dangereux %s", (value) => expect(() => normalizeImportPath(value)).toThrow());
  it("refuse les collisions Windows et doublons", () => {
    const operation = validManifest().operations[0];
    const upperPath = operation.path.toUpperCase();
    const manifest = validManifest({ operations: [operation, { ...operation, path: upperPath, contentFile: `changes/create/${upperPath}` }] });
    expect(() => validateManifestPaths(manifest)).toThrow("collision");
  });
  it("refuse un contentFile incohérent", () => expect(() => validateManifestPaths(validManifest({ operations: [{ ...validManifest().operations[0], contentFile: "changes/create/autre.md" }] }))).toThrow("incohérent"));
});

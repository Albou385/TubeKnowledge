import { describe, expect, it } from "vitest";
import { parseImportZip } from "@/lib/imports/archive";
import { IMPORT_LIMITS } from "@/lib/imports/constants";
import { makeZip, packageZip, validManifest } from "@/lib/imports/test-utils";

describe("sécurité ZIP", () => {
  it("lit un paquet direct valide", async () => expect((await parseImportZip(await packageZip())).manifest.packageId).toBe(validManifest().packageId));
  it("lit un paquet sous la racine unique autorisée", async () => expect((await parseImportZip(await packageZip(validManifest(), "tubeknowledge-import"))).review).toContain("Revue"));
  it("refuse un manifeste absent", async () => await expect(parseImportZip(await makeZip([{ name: "REVIEW.md", content: "x" }]))).rejects.toThrow("absent"));
  it("refuse plusieurs manifestes", async () => await expect(parseImportZip(await makeZip([{ name: "manifest.json", content: "{}" }, { name: "manifest.json", content: "{}" }]))).rejects.toThrow("Plusieurs"));
  it("refuse Zip Slip", async () => {
    const zip = await makeZip([{ name: "aa/evil.md", content: "x" }]);
    const mutated = Buffer.from(zip.toString("binary").replaceAll("aa/evil.md", "../evil.md"), "binary");
    await expect(parseImportZip(mutated)).rejects.toThrow();
  });
  it("refuse les fichiers inattendus et ZIP imbriqués", async () => {
    const manifest = validManifest();
    const files = [{ name: "manifest.json", content: JSON.stringify(manifest) }, { name: "REVIEW.md", content: "x" }, { name: manifest.operations[0].contentFile, content: "# Nouvelle notion\n\nContenu sûr.\n" }, { name: "extra.txt", content: "x" }];
    await expect(parseImportZip(await makeZip(files))).rejects.toThrow("inattendu");
    await expect(parseImportZip(await makeZip([{ name: "nested.zip", content: "x" }]))).rejects.toThrow("imbriqués");
  });
  it("refuse trop d’entrées", async () => {
    const files = Array.from({ length: IMPORT_LIMITS.maxEntries + 1 }, (_, index) => ({ name: `x${index}.md`, content: "x" }));
    await expect(parseImportZip(await makeZip(files))).rejects.toThrow("trop d’entrées");
  });
  it("refuse un ZIP trop volumineux ou corrompu", async () => {
    await expect(parseImportZip(Buffer.alloc(IMPORT_LIMITS.maxZipBytes + 1))).rejects.toThrow("volumineux");
    await expect(parseImportZip(Buffer.from("pas un zip"))).rejects.toThrow();
  });
  it("refuse un fichier décompressé trop volumineux et le contenu binaire", async () => {
    await expect(parseImportZip(await makeZip([{ name: "large.md", content: Buffer.alloc(IMPORT_LIMITS.maxMarkdownBytes + 1, 65) }]))).rejects.toThrow("Limite");
    const manifest = validManifest();
    await expect(parseImportZip(await makeZip([{ name: "manifest.json", content: JSON.stringify(manifest) }, { name: "REVIEW.md", content: "x" }, { name: manifest.operations[0].contentFile, content: Buffer.from([0, 1, 2]) }]))).rejects.toThrow("binaire");
  });
  it("refuse une archive chiffrée signalée", async () => {
    const zip = await packageZip(); const mutated = Buffer.from(zip);
    for (let i = 0; i < mutated.length - 10; i += 1) {
      const sig = mutated.readUInt32LE(i);
      if (sig === 0x04034b50) mutated.writeUInt16LE(mutated.readUInt16LE(i + 6) | 1, i + 6);
      if (sig === 0x02014b50) mutated.writeUInt16LE(mutated.readUInt16LE(i + 8) | 1, i + 8);
    }
    await expect(parseImportZip(mutated)).rejects.toThrow("chiffrées");
  });
});

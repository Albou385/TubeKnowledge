import { describe, expect, it } from "vitest";

import { MAX_TRANSCRIPT_UPLOAD_BYTES, validateTranscriptUpload } from "./upload";

describe("import local de transcription", () => {
  it.each(["notes.txt", "notes.md", "notes.vtt", "notes.srt"])("accepte %s en UTF-8", (name) => {
    expect(validateTranscriptUpload(name, Buffer.from("Bonjour éthique", "utf8")).content).toContain("éthique");
  });

  it.each(["../notes.txt", "folder/notes.txt", "notes.exe", "bad?.txt", ".."])("refuse le nom %s", (name) => {
    expect(() => validateTranscriptUpload(name, Buffer.from("texte"))).toThrow();
  });

  it("refuse UTF-8 invalide et contenu binaire", () => {
    expect(() => validateTranscriptUpload("notes.txt", Buffer.from([0xff, 0xfe]))).toThrow();
    expect(() => validateTranscriptUpload("notes.txt", Buffer.from([0, 1, 2, 3]))).toThrow();
  });

  it("refuse les fichiers vides ou trop grands", () => {
    expect(() => validateTranscriptUpload("notes.txt", Buffer.alloc(0))).toThrow("vide");
    expect(() => validateTranscriptUpload("notes.txt", Buffer.alloc(MAX_TRANSCRIPT_UPLOAD_BYTES + 1, 65))).toThrow("10 MiB");
  });
});


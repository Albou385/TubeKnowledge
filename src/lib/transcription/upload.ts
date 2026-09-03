import path from "node:path";

import { decodeUtf8 } from "@/lib/imports/hash";

export const MAX_TRANSCRIPT_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_UPLOAD_EXTENSIONS = new Set([".txt", ".md", ".vtt", ".srt"]);

export function validateTranscriptUpload(fileName: string, bytes: Buffer): { extension: ".txt" | ".md" | ".vtt" | ".srt"; content: string } {
  if (bytes.length === 0) throw new Error("Le fichier importé est vide.");
  if (bytes.length > MAX_TRANSCRIPT_UPLOAD_BYTES) throw new Error("Le fichier dépasse 10 MiB.");
  const baseName = path.basename(fileName);
  if (baseName !== fileName || /[<>:"/\\|?*\u0000-\u001f]/.test(fileName) || fileName === "." || fileName === "..") {
    throw new Error("Nom de fichier malveillant ou invalide.");
  }
  const extension = path.extname(fileName).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) throw new Error("Extension non autorisée. Utilisez TXT, MD, VTT ou SRT.");
  const content = decodeUtf8(bytes);
  if (looksBinary(content)) throw new Error("Contenu binaire ou extension déguisée refusé.");
  return { extension: extension as ".txt" | ".md" | ".vtt" | ".srt", content };
}

function looksBinary(content: string): boolean {
  if (!content) return false;
  let controls = 0;
  for (const character of content.slice(0, 8_192)) {
    const code = character.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controls += 1;
  }
  return controls / Math.min(content.length, 8_192) > 0.01;
}


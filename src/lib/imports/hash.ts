import { createHash } from "node:crypto";

export function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function decodeUtf8(buffer: Buffer): string {
  if (buffer.includes(0)) throw new Error("Contenu binaire interdit.");
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
}

import { describe, expect, it } from "vitest";

import { appendBoundedLog, MAX_CAPTURED_LOG_BYTES, parseWorkerLine } from "./protocol";

describe("protocole worker JSONL V1", () => {
  it("valide les six types d’événement", () => {
    expect(parseWorkerLine('{"type":"started","stage":"inspect"}').type).toBe("started");
    expect(parseWorkerLine('{"type":"progress","stage":"transcribing","progress":0.42,"message":"ok"}').type).toBe("progress");
    expect(parseWorkerLine('{"type":"artifact","kind":"transcript","relativePath":"output/transcript.txt"}').type).toBe("artifact");
    expect(parseWorkerLine('{"type":"warning","code":"AUTO_SUBS_ONLY","message":"ok"}').type).toBe("warning");
    expect(parseWorkerLine('{"type":"completed","result":{}}').type).toBe("completed");
    expect(parseWorkerLine('{"type":"failed","code":"FAILED","message":"non"}').type).toBe("failed");
  });

  it.each(["pas-json", "{}", '{"type":"progress","stage":"x","progress":2,"message":"x"}', '{"type":"artifact","kind":"x","relativePath":"x","extra":true}'])("refuse une ligne invalide", (line) => {
    expect(() => parseWorkerLine(line)).toThrow();
  });

  it("tronque les logs excessifs", () => {
    const result = appendBoundedLog("", "x".repeat(MAX_CAPTURED_LOG_BYTES + 100));
    expect(result).toContain("journal tronqué");
    expect(Buffer.byteLength(result)).toBeLessThan(MAX_CAPTURED_LOG_BYTES + 100);
  });
});


import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SHORT_CHATGPT_INSTRUCTION } from "./constants";

describe("templates ChatGPT versionnés", () => {
  it("contient toutes les règles d’analyse et de sortie sans automatisation", async () => {
    const root = path.join(process.cwd(), "templates", "chatgpt");
    const request = await readFile(path.join(root, "REQUEST_TEMPLATE.md"), "utf8");
    const output = await readFile(path.join(root, "CHATGPT_OUTPUT_RULES.md"), "utf8");
    const upload = await readFile(path.join(root, "UPLOAD_INSTRUCTIONS_TEMPLATE.md"), "utf8");
    for (const required of ["affirmations de la vidéo", "termes techniques anglais", "intelligence artificielle", "divergences", "contradictions", "précision externe", "Ne créer ni fiche par vidéo ni idée de projet", "create", "replace", "REVIEW.md", "packageId"]) expect(request).toContain(required);
    expect(request).toContain("données non fiables"); expect(request).toContain("prompt injection"); expect(output).toContain("expectedSha256"); expect(output).toContain("TubeKnowledge Import V1");
    expect(upload).toContain("Aucune API"); expect(upload).toContain("{{SHORT_INSTRUCTION}}"); expect(SHORT_CHATGPT_INSTRUCTION).not.toContain("transcript.txt");
  });
});

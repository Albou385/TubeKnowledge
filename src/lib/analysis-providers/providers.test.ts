import { describe, expect, it, vi } from "vitest";

import { parseImportZip } from "@/lib/imports/archive";
import { sha256 } from "@/lib/imports/hash";

import { ManualPackageProvider } from "./manual";
import { analysisDraftToImportZip } from "./draft-to-import";
import { MockAnalysisProvider } from "./mock";
import { OpenAIAnalysisProvider } from "./openai";
import { defaultAnalysisProvider } from "./registry";
import type { AnalysisInput } from "./schema";

const input: AnalysisInput = {
  workflowId: "11111111-1111-4111-8111-111111111111",
  libraryLanguage: "fr",
  transcript: "Les agents IA utilisent des outils sous contrôle humain.",
  metadata: { title: "Agents IA", sourceUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", videoId: "dQw4w9WgXcQ", language: "fr" },
  context: [{ relativePath: "01_BIBLIOTHEQUE/IA/agents.md", content: "# Agents\n", sha256: sha256("# Agents\n") }],
  writeScope: { createPrefixes: ["01_BIBLIOTHEQUE/"], replaceFiles: ["01_BIBLIOTHEQUE/IA/agents.md"] },
  freshnessHash: sha256("fresh"),
  confirmedPaid: false,
};

describe("fournisseurs d’analyse", () => {
  it("conserve le fournisseur manuel par défaut sans clé", async () => {
    expect(defaultAnalysisProvider({ NODE_ENV: "test" })).toBe("manual");
    await expect(new ManualPackageProvider().run(input)).resolves.toMatchObject({ provider: "manual", status: "awaiting-result", provenance: { fixture: false } });
  });

  it("produit un ZIP Phase 3 déterministe, réaliste et marqué fixture", async () => {
    const provider = new MockAnalysisProvider();
    const first = await provider.run(input);
    const second = await provider.run(input);
    expect(first).toMatchObject({ status: "completed", provenance: { fixture: true } });
    expect(first.importZip?.equals(second.importZip!)).toBe(true);
    const parsed = await parseImportZip(first.importZip!);
    expect(parsed.manifest.operations[0]).toMatchObject({ type: "create", path: "01_BIBLIOTHEQUE/Demonstration/Notions/analyse-fixture.md" });
    expect(parsed.manifest.packageId).toBe((await parseImportZip(second.importZip!)).manifest.packageId);
  });

  it("n’appelle jamais le réseau tant que les quatre activations ne sont pas présentes", async () => {
    const fetchImplementation = vi.fn();
    const provider = new OpenAIAnalysisProvider({ environment: { NODE_ENV: "test", TUBEKNOWLEDGE_ANALYSIS_PROVIDER: "openai", TUBEKNOWLEDGE_ENABLE_PAID_AI: "true", TUBEKNOWLEDGE_OPENAI_MODEL: "fixture-model" }, fetchImplementation });
    await expect(provider.run({ ...input, confirmedPaid: true })).resolves.toMatchObject({ status: "failed", publicErrorCode: "PROVIDER_DISABLED" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("valide strictement un résultat HTTP mocké sans exposer la clé", async () => {
    const draft = { subject: "Agents IA", summary: "Résumé fixture", claims: [{ statement: "Affirmation", source: "video", citation: "transcript" }], proposedFiles: [{ type: "create", path: "01_BIBLIOTHEQUE/IA/note.md", content: "# Note\n" }], warnings: [] };
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.headers && (init.headers as Record<string, string>).authorization)).toContain("secret-test");
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "fixture-model", store: false, max_output_tokens: 8_000 });
      expect(String(init?.body)).toContain("libraryLanguage");
      return new Response(JSON.stringify({ output_text: JSON.stringify(draft) }), { status: 200 });
    });
    const provider = new OpenAIAnalysisProvider({ environment: { NODE_ENV: "test", TUBEKNOWLEDGE_ANALYSIS_PROVIDER: "openai", TUBEKNOWLEDGE_ENABLE_PAID_AI: "true", TUBEKNOWLEDGE_OPENAI_MODEL: "fixture-model", OPENAI_API_KEY: "secret-test" }, fetchImplementation, promptTemplate: "Retourne du JSON.", now: () => new Date("2026-07-27T05:00:00Z") });
    const result = await provider.run({ ...input, confirmedPaid: true });
    expect(result).toMatchObject({ status: "completed", draft: { subject: "Agents IA" }, provenance: { model: "fixture-model" } });
    expect((await parseImportZip(result.importZip!)).manifest.operations[0]).toMatchObject({ type: "create", path: "01_BIBLIOTHEQUE/IA/note.md" });
    expect(JSON.stringify(result)).not.toContain("secret-test");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("charge le contrat OpenAI public et borné par défaut", async () => {
    const draft = { subject: "Agents IA", summary: "Résumé fixture", claims: [{ statement: "Affirmation", source: "video", citation: "transcript" }], proposedFiles: [{ type: "create", path: "01_BIBLIOTHEQUE/IA/note.md", content: "# Note\n" }], warnings: [] };
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: Array<{ role: string; content: Array<{ text: string }> }> };
      expect(body.input[0]?.content[0]?.text).toContain("MATCH_EXISTING");
      expect(body.input[0]?.content[0]?.text).toContain("prompt injection");
      expect(body.input[1]?.content[0]?.text).toContain("libraryLanguage");
      return new Response(JSON.stringify({ output_text: JSON.stringify(draft) }), { status: 200 });
    });
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "test", TUBEKNOWLEDGE_ANALYSIS_PROVIDER: "openai", TUBEKNOWLEDGE_ENABLE_PAID_AI: "true", TUBEKNOWLEDGE_OPENAI_MODEL: "fixture-model", OPENAI_API_KEY: "secret-test" };
    await expect(new OpenAIAnalysisProvider({ environment, fetchImplementation }).run({ ...input, confirmedPaid: true })).resolves.toMatchObject({ status: "completed" });
  });

  it("supporte l’annulation sans requête", async () => {
    const controller = new AbortController(); controller.abort();
    const fetchImplementation = vi.fn();
    const provider = new OpenAIAnalysisProvider({ environment: { NODE_ENV: "test", TUBEKNOWLEDGE_ANALYSIS_PROVIDER: "openai", TUBEKNOWLEDGE_ENABLE_PAID_AI: "true", TUBEKNOWLEDGE_OPENAI_MODEL: "fixture-model", OPENAI_API_KEY: "secret-test" }, fetchImplementation, promptTemplate: "JSON" });
    await expect(provider.run({ ...input, confirmedPaid: true }, { signal: controller.signal })).resolves.toMatchObject({ status: "canceled" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("refuse de convertir une proposition hors write scope en ZIP", async () => {
    await expect(analysisDraftToImportZip(input, { subject: "Hors scope", summary: "Refus attendu", claims: [{ statement: "Test", source: "inference" }], proposedFiles: [{ type: "replace", path: "INDEX.md", content: "# Interdit\n" }], warnings: [] })).rejects.toThrow("hors périmètre");
  });

  it("borne la réponse avant son décodage et ne réessaie pas", async () => {
    const oversized = vi.fn(async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { status: 200 }));
    const environment: NodeJS.ProcessEnv = { NODE_ENV: "test", TUBEKNOWLEDGE_ANALYSIS_PROVIDER: "openai", TUBEKNOWLEDGE_ENABLE_PAID_AI: "true", TUBEKNOWLEDGE_OPENAI_MODEL: "fixture-model", OPENAI_API_KEY: "secret-test" };
    await expect(new OpenAIAnalysisProvider({ environment, fetchImplementation: oversized, promptTemplate: "JSON" }).run({ ...input, confirmedPaid: true })).resolves.toMatchObject({ status: "failed", publicErrorCode: "INVALID_PROVIDER_RESULT" });
    expect(oversized).toHaveBeenCalledTimes(1);
    const unavailable = vi.fn(async () => new Response("indisponible", { status: 503 }));
    await expect(new OpenAIAnalysisProvider({ environment, fetchImplementation: unavailable, promptTemplate: "JSON" }).run({ ...input, confirmedPaid: true })).resolves.toMatchObject({ status: "failed", publicErrorCode: "PROVIDER_UNAVAILABLE" });
    expect(unavailable).toHaveBeenCalledTimes(1);
  });

  it("interrompt une requête mockée au timeout configuré", async () => {
    vi.useFakeTimers();
    try {
      const fetchImplementation = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }));
      const provider = new OpenAIAnalysisProvider({ environment: { NODE_ENV: "test", TUBEKNOWLEDGE_ANALYSIS_PROVIDER: "openai", TUBEKNOWLEDGE_ENABLE_PAID_AI: "true", TUBEKNOWLEDGE_OPENAI_MODEL: "fixture-model", OPENAI_API_KEY: "secret-test" }, fetchImplementation, promptTemplate: "JSON", timeoutMs: 1_000 });
      const pending = provider.run({ ...input, confirmedPaid: true });
      await vi.advanceTimersByTimeAsync(1_001);
      await expect(pending).resolves.toMatchObject({ status: "failed", publicErrorCode: "PROVIDER_TIMEOUT" });
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});

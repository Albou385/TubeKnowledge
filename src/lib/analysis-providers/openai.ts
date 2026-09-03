import { readFile } from "node:fs/promises";
import path from "node:path";

import { analysisDraftSchema, analysisInputSchema, type AnalysisInput } from "./schema";
import { analysisDraftToImportZip } from "./draft-to-import";
import type { AnalysisProvider, AnalysisProviderAvailability, AnalysisProviderResult } from "./types";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120_000;

interface OpenAIProviderOptions {
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
  promptTemplate?: string;
  environment?: NodeJS.ProcessEnv;
  now?: () => Date;
}

function providerConfig(environment: NodeJS.ProcessEnv) {
  const providerSelected = environment.TUBEKNOWLEDGE_ANALYSIS_PROVIDER === "openai";
  const paidEnabled = environment.TUBEKNOWLEDGE_ENABLE_PAID_AI === "true";
  const keyPresent = Boolean(environment.OPENAI_API_KEY?.trim());
  const model = environment.TUBEKNOWLEDGE_OPENAI_MODEL?.trim();
  return { configured: providerSelected && paidEnabled && keyPresent && Boolean(model), providerSelected, paidEnabled, keyPresent, model };
}

function extractOutputText(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("Réponse fournisseur invalide.");
  const response = value as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }> };
  if (typeof response.output_text === "string") return response.output_text;
  const texts = response.output?.flatMap((item) => item.content ?? []).filter((item) => item.type === "output_text" && typeof item.text === "string").map((item) => item.text as string) ?? [];
  if (!texts.length) throw new Error("Réponse fournisseur sans texte.");
  return texts.join("\n");
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

async function readBoundedResponse(response: Response, maximumBytes = MAX_RESPONSE_BYTES): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) throw new Error("Réponse fournisseur trop volumineuse.");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(joined);
}

export class OpenAIAnalysisProvider implements AnalysisProvider {
  readonly id = "openai" as const;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly now: () => Date;

  constructor(private readonly options: OpenAIProviderOptions = {}) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.timeoutMs = Math.min(Math.max(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000), 300_000);
    this.environment = options.environment ?? process.env;
    this.now = options.now ?? (() => new Date());
  }

  availability(environment = this.environment): AnalysisProviderAvailability {
    const config = providerConfig(environment);
    return {
      id: this.id,
      label: "OpenAI facultatif",
      configured: config.configured,
      automatic: true,
      model: config.configured ? config.model : undefined,
      reason: config.configured ? "Activation locale explicite; confirmation requise avant chaque requête." : "Désactivé par défaut. Fournisseur, dépense, modèle et clé doivent tous être configurés localement.",
    };
  }

  async run(rawInput: AnalysisInput, options: { signal?: AbortSignal } = {}): Promise<AnalysisProviderResult> {
    const input = analysisInputSchema.parse(rawInput);
    const config = providerConfig(this.environment);
    const startedAt = this.now().toISOString();
    const inputCharacters = input.transcript.length + input.context.reduce((sum, item) => sum + item.content.length, 0);
    const base = { schemaVersion: 1 as const, provider: this.id, startedAt, freshnessHash: input.freshnessHash, metrics: { inputCharacters, estimatedInputTokens: Math.ceil(inputCharacters / 4), outputCharacters: 0 }, provenance: { provider: this.id, model: config.model, fixture: false } };
    if (!config.configured || !input.confirmedPaid) return { ...base, status: "failed", publicErrorCode: "PROVIDER_DISABLED" };
    if (options.signal?.aborted) return { ...base, status: "canceled", publicErrorCode: "ANALYSIS_CANCELED" };

    const template = this.options.promptTemplate ?? await readFile(path.join(process.cwd(), "templates", "analysis", "OPENAI_ANALYSIS_PROMPT_V1.md"), "utf8");
    const untrustedPayload = JSON.stringify({ metadata: input.metadata, transcript: input.transcript, context: input.context, writeScope: input.writeScope, freshnessHash: input.freshnessHash });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.fetchImplementation("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.environment.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: config.model, store: false, input: [{ role: "system", content: [{ type: "input_text", text: template }] }, { role: "user", content: [{ type: "input_text", text: `<untrusted_tubeknowledge_input>\n${untrustedPayload}\n</untrusted_tubeknowledge_input>` }] }], max_output_tokens: 8_000 }),
        signal: controller.signal,
      });
      const text = await readBoundedResponse(response);
      if (!response.ok) return { ...base, status: "failed", publicErrorCode: "PROVIDER_UNAVAILABLE" };
      const draft = analysisDraftSchema.parse(parseJsonText(extractOutputText(JSON.parse(text))));
      const importZip = await analysisDraftToImportZip(input, draft, { now: this.now() });
      return { ...base, status: "completed", completedAt: this.now().toISOString(), metrics: { ...base.metrics, outputCharacters: JSON.stringify(draft).length }, draft, importZip };
    } catch {
      if (controller.signal.aborted) return { ...base, status: options.signal?.aborted ? "canceled" : "failed", publicErrorCode: options.signal?.aborted ? "ANALYSIS_CANCELED" : "PROVIDER_TIMEOUT" };
      return { ...base, status: "failed", publicErrorCode: "INVALID_PROVIDER_RESULT" };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

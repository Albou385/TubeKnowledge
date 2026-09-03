import { SHORT_CHATGPT_INSTRUCTION } from "@/lib/chatgpt-packages/constants";

import { analysisInputSchema, type AnalysisInput } from "./schema";
import type { AnalysisProvider, AnalysisProviderAvailability, AnalysisProviderResult } from "./types";

export class ManualPackageProvider implements AnalysisProvider {
  readonly id = "manual" as const;

  availability(): AnalysisProviderAvailability {
    return { id: this.id, label: "Paquet manuel ChatGPT", configured: true, automatic: false };
  }

  async run(rawInput: AnalysisInput): Promise<AnalysisProviderResult> {
    const input = analysisInputSchema.parse(rawInput);
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      provider: this.id,
      status: "awaiting-result",
      startedAt: now,
      freshnessHash: input.freshnessHash,
      metrics: { inputCharacters: input.transcript.length + input.context.reduce((sum, item) => sum + item.content.length, 0), estimatedInputTokens: Math.ceil((input.transcript.length + input.context.reduce((sum, item) => sum + item.content.length, 0)) / 4), outputCharacters: SHORT_CHATGPT_INSTRUCTION.length },
      provenance: { provider: this.id, fixture: false },
    };
  }
}

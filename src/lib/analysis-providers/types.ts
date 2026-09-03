import type { AnalysisDraft, AnalysisInput } from "./schema";

export type AnalysisProviderId = "manual" | "mock" | "openai";
export type AnalysisProviderStatus = "awaiting-result" | "completed" | "failed" | "canceled";

export interface AnalysisProviderAvailability {
  id: AnalysisProviderId;
  label: string;
  configured: boolean;
  automatic: boolean;
  reason?: string;
  model?: string;
}

export interface AnalysisProviderResult {
  schemaVersion: 1;
  provider: AnalysisProviderId;
  status: AnalysisProviderStatus;
  startedAt: string;
  completedAt?: string;
  freshnessHash: string;
  metrics: { inputCharacters: number; estimatedInputTokens: number; outputCharacters: number };
  provenance: { provider: AnalysisProviderId; model?: string; fixture: boolean };
  draft?: AnalysisDraft;
  importZip?: Buffer;
  publicErrorCode?: "PROVIDER_DISABLED" | "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "INVALID_PROVIDER_RESULT" | "ANALYSIS_CANCELED";
}

export interface AnalysisProvider {
  readonly id: AnalysisProviderId;
  availability(environment?: NodeJS.ProcessEnv): AnalysisProviderAvailability;
  run(input: AnalysisInput, options?: { signal?: AbortSignal }): Promise<AnalysisProviderResult>;
}

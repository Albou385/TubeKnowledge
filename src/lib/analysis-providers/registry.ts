import { ManualPackageProvider } from "./manual";
import { MockAnalysisProvider } from "./mock";
import { OpenAIAnalysisProvider } from "./openai";
import type { AnalysisProvider, AnalysisProviderAvailability, AnalysisProviderId } from "./types";

export function analysisProviders(environment: NodeJS.ProcessEnv = process.env): Record<AnalysisProviderId, AnalysisProvider> {
  return { manual: new ManualPackageProvider(), mock: new MockAnalysisProvider(), openai: new OpenAIAnalysisProvider({ environment }) };
}

export function listAnalysisProviderAvailability(environment: NodeJS.ProcessEnv = process.env): AnalysisProviderAvailability[] {
  const providers = analysisProviders(environment);
  return [providers.manual.availability(environment), providers.mock.availability(environment), providers.openai.availability(environment)];
}

export function defaultAnalysisProvider(environment: NodeJS.ProcessEnv = process.env): AnalysisProviderId {
  const requested = environment.TUBEKNOWLEDGE_ANALYSIS_PROVIDER;
  if (requested === "mock") return "mock";
  if (requested === "openai" && analysisProviders(environment).openai.availability(environment).configured) return "openai";
  return "manual";
}

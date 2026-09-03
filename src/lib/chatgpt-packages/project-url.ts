import { z } from "zod";

const projectUrlSchema = z.string().url().refine((value) => new URL(value).protocol === "https:", "L’URL du projet ChatGPT doit utiliser HTTPS.");

export function getChatGptProjectUrl(environment: NodeJS.ProcessEnv = process.env): string | null {
  const value = environment.TUBEKNOWLEDGE_CHATGPT_PROJECT_URL?.trim();
  if (!value) return null;
  return projectUrlSchema.parse(value);
}

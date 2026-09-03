import { z } from "zod";

export const MAX_SEARCH_QUERY_LENGTH = 120;
export const MAX_SEARCH_RESULTS = 50;

const searchRequestSchema = z.object({
  q: z.string().trim().min(1, "Saisissez un terme à rechercher.").max(
    MAX_SEARCH_QUERY_LENGTH,
    `La recherche est limitée à ${MAX_SEARCH_QUERY_LENGTH} caractères.`,
  ),
  limit: z.coerce.number().int().min(1).max(MAX_SEARCH_RESULTS).default(20),
});

export type SearchRequest = z.infer<typeof searchRequestSchema>;

export function parseSearchRequest(input: unknown): SearchRequest {
  return searchRequestSchema.parse(input);
}

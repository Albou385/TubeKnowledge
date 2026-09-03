const STOPWORDS = new Set([
  "alors", "avec", "avoir", "cela", "cette", "comme", "dans", "des", "donc", "elle", "elles", "entre", "être", "fait", "faire", "mais", "nous", "pour", "plus", "sans", "sont", "sur", "très", "une", "vous",
  "about", "after", "also", "and", "are", "because", "been", "before", "being", "but", "can", "could", "from", "have", "into", "more", "not", "only", "other", "should", "that", "the", "their", "then", "there", "these", "they", "this", "through", "with", "would", "your",
]);

export interface SignificantTerm { term: string; count: number }

export function extractSignificantTerms(input: string, limit = 24): SignificantTerm[] {
  const counts = new Map<string, number>();
  const tokens = input.normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}+#._-]*/gu) ?? [];
  for (const raw of tokens) {
    const acronym = /^[A-Z0-9]{2,8}$/.test(raw);
    const term = raw.toLocaleLowerCase("fr").replace(/^[._-]+|[._-]+$/g, "");
    if (!term || STOPWORDS.has(term) || (term.length < 3 && !acronym)) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([term, count]) => ({ term, count }))
    .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term, "fr"))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}

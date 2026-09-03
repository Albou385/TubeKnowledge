export const DEFAULT_CONFLICT_COPY_PATTERNS = [
  /(?:\s|[-_])conflicted copy(?:\s|[-_]|\.|$)/i,
  /(?:\s|[-_])copie en conflit(?:\s|[-_]|\.|$)/i,
  /(?:\s|[-_])conflict(?:\s|[-_])\d+(?:\.|$)/i,
] as const;

export function looksLikeConflictCopy(relativePath: string, patterns: readonly RegExp[] = DEFAULT_CONFLICT_COPY_PATTERNS): boolean { return patterns.some((pattern) => pattern.test(relativePath)); }


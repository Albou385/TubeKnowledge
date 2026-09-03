function encodeLibraryPath(target: string): string {
  const normalized = target.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const withoutExtension = normalized.toLowerCase().endsWith(".md")
    ? normalized.slice(0, -3)
    : normalized;
  return withoutExtension
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export function convertObsidianLinks(markdown: string): string {
  return markdown.replace(
    /(^|[^!])\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g,
    (_match, prefix: string, rawTarget: string, rawLabel?: string) => {
      const target = rawTarget.trim();
      const label = rawLabel?.trim() || target;
      const encodedPath = encodeLibraryPath(target);
      return encodedPath ? `${prefix}[${label}](/library/${encodedPath}.md)` : _match;
    },
  );
}

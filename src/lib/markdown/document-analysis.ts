import type { MarkdownHeading } from "@/lib/library/types";

function plainHeadingText(value: string): string {
  return value
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();
}

export function slugifyHeading(value: string): string {
  const slug = plainHeadingText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/[\s-]+/g, "-");

  return slug || "section";
}

export function extractHeadings(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const occurrences = new Map<string, number>();
  let insideFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;

    const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;

    const text = plainHeadingText(match[2]);
    if (!text) continue;
    const baseId = slugifyHeading(text);
    const count = (occurrences.get(baseId) ?? 0) + 1;
    occurrences.set(baseId, count);
    headings.push({
      level: match[1].length as 2 | 3,
      text,
      id: count === 1 ? baseId : `${baseId}-${count}`,
    });
  }

  return headings;
}

export function countWords(markdown: string): number {
  const plainText = markdown
    .replace(/^---[\s\S]*?---\s*/m, " ")
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ")
    .replace(/!?\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?]]/g, (_match, target: string, label?: string) => label ?? target)
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_~`|\-[\]{}()]/g, " ");

  return plainText.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

export function getMainSection(relativePath: string): string {
  const segments = relativePath.split("/");
  return segments.length > 1 ? segments[0] : "Racine";
}

import type { LibraryEnvironment } from "@/lib/config/library-config";
import { readMarkdownDocument } from "@/lib/library/library-reader";

export const VIDEOS_DOCUMENT_PATH = "02_SOURCES/videos.md";

export interface VideoEntry {
  title: string;
  url: string | null;
  sections: string[];
  status: string;
}

function splitTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replaceAll("\\|", "|").trim());
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function parseVideosTable(markdown: string): VideoEntry[] {
  const rows = markdown.split(/\r?\n/).filter((line) => /^\s*\|.*\|\s*$/.test(line));
  if (rows.length < 2) return [];

  return rows.slice(2).flatMap((row) => {
    const [rawTitle = "", rawUrl = "", rawSections = "", rawStatus = ""] = splitTableRow(row);
    const title = rawTitle.replace(/^[_*]+|[_*]+$/g, "").trim();
    if (!title || /aucune vidéo/i.test(title)) return [];

    return [{
      title,
      url: isSafeExternalUrl(rawUrl) ? rawUrl : null,
      sections: rawSections.split(/[,;]/).map((value) => value.trim()).filter(Boolean),
      status: rawStatus || "Non précisé",
    }];
  });
}

export async function readVideos(
  environment: LibraryEnvironment = process.env,
): Promise<{ entries: VideoEntry[]; sourcePath: string }> {
  const document = await readMarkdownDocument(VIDEOS_DOCUMENT_PATH, environment);
  return { entries: parseVideosTable(document.content), sourcePath: document.relativePath };
}

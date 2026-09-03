export type LibraryNode =
  | {
      type: "directory";
      name: string;
      relativePath: string;
      children: LibraryNode[];
    }
  | {
      type: "file";
      name: string;
      relativePath: string;
    };

export interface LibraryStats {
  topLevelSections: number;
  markdownFiles: number;
}

export interface AvailableLibrarySnapshot {
  available: true;
  configValid: true;
  accessible: true;
  indexPresent: true;
  libraryName: string;
  tree: LibraryNode[];
  stats: LibraryStats;
}

export interface UnavailableLibrarySnapshot {
  available: false;
  configValid: boolean;
  accessible: boolean;
  indexPresent: boolean;
  message: string;
}

export type LibrarySnapshot =
  | AvailableLibrarySnapshot
  | UnavailableLibrarySnapshot;

export interface MarkdownDocument {
  content: string;
  relativePath: string;
  title: string;
  lastModified: string;
  wordCount: number;
  section: string;
  headings: MarkdownHeading[];
}

export interface MarkdownHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

export interface SearchResult {
  title: string;
  relativePath: string;
  section: string;
  excerpt: string;
  score: number;
}

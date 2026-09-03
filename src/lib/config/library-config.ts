import path from "node:path";
import { z } from "zod";

const libraryConfigSchema = z.object({
  YOUTUBE_LIBRARY_PATH: z
    .string({ error: "YOUTUBE_LIBRARY_PATH est requise." })
    .trim()
    .min(1, "YOUTUBE_LIBRARY_PATH est requise."),
});

export type LibraryConfigResult =
  | { ok: true; rootPath: string }
  | { ok: false; message: string };

export type LibraryEnvironment = Readonly<Record<string, string | undefined>>;

export function parseLibraryConfig(
  environment: LibraryEnvironment = process.env,
): LibraryConfigResult {
  const parsed = libraryConfigSchema.safeParse(environment);

  if (!parsed.success) {
    return {
      ok: false,
      message:
        "La variable YOUTUBE_LIBRARY_PATH est absente. Créez .env.local, définissez-la, puis redémarrez l’application.",
    };
  }

  const rootPath = path.normalize(parsed.data.YOUTUBE_LIBRARY_PATH);

  if (!path.isAbsolute(rootPath)) {
    return {
      ok: false,
      message: "YOUTUBE_LIBRARY_PATH doit contenir un chemin absolu vers la bibliothèque.",
    };
  }

  return { ok: true, rootPath };
}

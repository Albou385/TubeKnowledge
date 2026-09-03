import os from "node:os";
import path from "node:path";

import { isInsidePath } from "./paths";

export interface RuntimeLocation {
  runtimePath: string;
  acquisitionsPath: string;
  modelCachePath: string;
}

export function getRuntimeLocation(environment: NodeJS.ProcessEnv = process.env): RuntimeLocation {
  const configuredRuntime = environment.TUBEKNOWLEDGE_RUNTIME_PATH;
  if (configuredRuntime && !path.isAbsolute(configuredRuntime)) throw new Error("TUBEKNOWLEDGE_RUNTIME_PATH doit être un chemin absolu.");
  const runtimePath = path.normalize(configuredRuntime || path.join(environment.LOCALAPPDATA || os.tmpdir(), "TubeKnowledge", "runtime"));
  if (environment.YOUTUBE_LIBRARY_PATH && isInsidePath(path.normalize(environment.YOUTUBE_LIBRARY_PATH), runtimePath)) {
    throw new Error("Le runtime de transcription doit être situé hors du vault.");
  }
  const oneDrive = environment.OneDrive || environment.OneDriveConsumer || environment.OneDriveCommercial;
  if (oneDrive && isInsidePath(path.normalize(oneDrive), runtimePath)) {
    throw new Error("Le runtime de transcription doit être situé hors de OneDrive.");
  }
  return { runtimePath, acquisitionsPath: path.join(runtimePath, "acquisitions"), modelCachePath: path.join(runtimePath, "models") };
}

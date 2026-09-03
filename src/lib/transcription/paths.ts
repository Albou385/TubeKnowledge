import path from "node:path";

export function isInsidePath(parent: string, candidate: string): boolean {
  const relative = path.relative(path.normalize(parent), path.normalize(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

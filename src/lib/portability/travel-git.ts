import { execFileSync } from "node:child_process";
import path from "node:path";

export const TRAVEL_PREPARE_BRANCH = "main";
export const TRAVEL_PREPARE_UPSTREAM = "origin/main";

type GitRunner = (args: string[]) => string;

export function assertTravelRemoteMatchesHead(runGit: GitRunner): void {
  let remoteMain: string;
  try {
    const line = runGit(["ls-remote", "--exit-code", "origin", "refs/heads/main"]);
    const [sha, ref, ...extra] = line.split(/\s+/);
    if (!/^[0-9a-f]{40}$/i.test(sha) || ref !== "refs/heads/main" || extra.length) throw new Error();
    remoteMain = sha;
  } catch {
    throw new Error("Impossible de vérifier origin/main directement sur GitHub; Prepare est refusé.");
  }
  if (runGit(["rev-parse", "HEAD"]).toLowerCase() !== remoteMain.toLowerCase()) {
    throw new Error("main local ne correspond pas à origin/main distant; synchronisez le dépôt avant Prepare.");
  }
}

function defaultGitRunner(projectRoot: string): GitRunner {
  return (args) => execFileSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function assertGitReadyForTravel(projectRoot = process.cwd(), runGit = defaultGitRunner(projectRoot)): void {
  if (path.resolve(runGit(["rev-parse", "--show-toplevel"])) !== path.resolve(projectRoot)) {
    throw new Error("La racine Git ne correspond pas au projet.");
  }
  if (runGit(["branch", "--show-current"]) !== TRAVEL_PREPARE_BRANCH) {
    throw new Error(`La branche ${TRAVEL_PREPARE_BRANCH} doit être active.`);
  }
  if (runGit(["status", "--porcelain=v1"])) {
    throw new Error("Le dépôt doit être propre avant Prepare.");
  }
  try {
    if (!runGit(["remote", "get-url", "origin"])) throw new Error();
  } catch {
    throw new Error("Le remote origin est absent.");
  }

  let upstream: string;
  try {
    upstream = runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  } catch {
    throw new Error(`La branche ${TRAVEL_PREPARE_BRANCH} doit avoir ${TRAVEL_PREPARE_UPSTREAM} comme upstream avant Prepare.`);
  }
  if (upstream !== TRAVEL_PREPARE_UPSTREAM) {
    throw new Error(`L’upstream requis pour Prepare est ${TRAVEL_PREPARE_UPSTREAM}.`);
  }

  const counts = runGit(["rev-list", "--left-right", "--count", `${TRAVEL_PREPARE_UPSTREAM}...HEAD`])
    .split(/\s+/)
    .map(Number);
  const [behind, ahead] = counts;
  if (!Number.isInteger(behind) || !Number.isInteger(ahead)) {
    throw new Error("La synchronisation Git n’a pas pu être mesurée.");
  }
  if (behind !== 0 || ahead !== 0) {
    throw new Error(`main local et origin/main doivent être strictement synchronisés avant Prepare (behind=${behind}, ahead=${ahead}).`);
  }
  assertTravelRemoteMatchesHead(runGit);
}

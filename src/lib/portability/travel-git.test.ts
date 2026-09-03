import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assertGitReadyForTravel } from "./travel-git";

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-travel-git-"));
  temporary.push(root);
  const origin = path.join(root, "origin.git");
  const project = path.join(root, "project");
  git(root, ["init", "--bare", "--initial-branch=main", origin]);
  git(root, ["init", "--initial-branch=main", project]);
  git(project, ["config", "user.name", "TubeKnowledge Test"]);
  git(project, ["config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(project, "README.md"), "fixture\n", "utf8");
  git(project, ["add", "README.md"]);
  git(project, ["commit", "-m", "test: initialiser la fixture"]);
  git(project, ["remote", "add", "origin", origin]);
  git(project, ["push", "-u", "origin", "main"]);
  return { root, origin, project };
}

describe("garde Git du Prepare Travel réel", () => {
  it("autorise main propre strictement synchronisé avec origin/main", async () => {
    const value = await fixture();
    expect(() => assertGitReadyForTravel(value.project)).not.toThrow();
  });

  it("refuse toute autre branche", async () => {
    const value = await fixture();
    git(value.project, ["switch", "-c", "fix/autre-branche"]);
    expect(() => assertGitReadyForTravel(value.project)).toThrow("La branche main doit être active.");
  });

  it("refuse main en avance sur origin/main", async () => {
    const value = await fixture();
    await writeFile(path.join(value.project, "ahead.txt"), "ahead\n", "utf8");
    git(value.project, ["add", "ahead.txt"]);
    git(value.project, ["commit", "-m", "test: créer une avance locale"]);
    expect(() => assertGitReadyForTravel(value.project)).toThrow("behind=0, ahead=1");
  });

  it("refuse main en retard sur origin/main", async () => {
    const value = await fixture();
    const peer = path.join(value.root, "peer");
    git(value.root, ["clone", value.origin, peer]);
    git(peer, ["config", "user.name", "TubeKnowledge Test"]);
    git(peer, ["config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(peer, "behind.txt"), "behind\n", "utf8");
    git(peer, ["add", "behind.txt"]);
    git(peer, ["commit", "-m", "test: créer une avance distante"]);
    git(peer, ["push", "origin", "main"]);
    git(value.project, ["fetch", "origin"]);
    expect(() => assertGitReadyForTravel(value.project)).toThrow("behind=1, ahead=0");
  });

  it("refuse un origin/main distant avancé même si la ref locale est périmée", async () => {
    const value = await fixture();
    const peer = path.join(value.root, "peer-stale");
    git(value.root, ["clone", value.origin, peer]);
    git(peer, ["config", "user.name", "TubeKnowledge Test"]);
    git(peer, ["config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(peer, "remote.txt"), "remote\n", "utf8");
    git(peer, ["add", "remote.txt"]);
    git(peer, ["commit", "-m", "test: avancer le remote sans fetch local"]);
    git(peer, ["push", "origin", "main"]);
    expect(() => assertGitReadyForTravel(value.project)).toThrow("origin/main distant");
  });

  it("refuse Prepare si origin/main ne peut pas être vérifié en direct", async () => {
    const value = await fixture();
    git(value.project, ["remote", "set-url", "origin", path.join(value.root, "origin-absent.git")]);
    expect(() => assertGitReadyForTravel(value.project)).toThrow("Impossible de vérifier origin/main directement");
  });
});

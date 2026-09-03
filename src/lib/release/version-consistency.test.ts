import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDiagnosticOverview } from "@/lib/diagnostics/overview";
import { createPortabilityBackup } from "@/lib/portability/backup-builder";
import { getPortabilityConfig } from "@/lib/portability/config";
import { ensureMachineIdentity } from "@/lib/portability/machine-identity";
import { APP_VERSION } from "./version";

async function text(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("cohérence de la version de release", () => {
  it("synchronise les manifests et les fallbacks runtime", async () => {
    const packageJson = JSON.parse(await text("package.json")) as { version: string };
    const packageLock = JSON.parse(await text("package-lock.json")) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    const version = packageJson.version;
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/);
    expect(APP_VERSION).toBe(version);
    const pep440Version = version.replace(/-rc\.(\d+)$/, "rc$1");
    expect(pep440Version).toMatch(/^\d+\.\d+\.\d+(?:rc\d+)?$/);

    expect(packageLock.version).toBe(version);
    expect(packageLock.packages[""].version).toBe(version);
    await expect(text("transcription-worker/pyproject.toml")).resolves.toContain(
      `version = "${pep440Version}"`,
    );
    await expect(
      text("transcription-worker/tubeknowledge_worker/__init__.py"),
    ).resolves.toContain(`__version__ = "${version}"`);
  });

  it("expose la version RC dans les diagnostics et les backups", async () => {
    const previousVersion = process.env.npm_package_version;
    delete process.env.npm_package_version;
    try {
      await expect(getDiagnosticOverview({ NODE_ENV: "test" })).resolves.toMatchObject({
        version: APP_VERSION,
      });
    } finally {
      if (previousVersion === undefined) delete process.env.npm_package_version;
      else process.env.npm_package_version = previousVersion;
    }

    const root = await mkdtemp(path.join(os.tmpdir(), "tk-version-"));
    roots.push(root);
    const vault = path.join(root, "vault");
    await mkdir(vault);
    await writeFile(path.join(vault, "INDEX.md"), "# Index\n");
    const config = getPortabilityConfig({
      YOUTUBE_LIBRARY_PATH: vault,
      TUBEKNOWLEDGE_PORTABILITY_STATE_PATH: path.join(root, "state"),
      TUBEKNOWLEDGE_BACKUP_PATH: path.join(root, "backups"),
      TUBEKNOWLEDGE_STABILITY_WINDOW_SECONDS: "0",
    });
    const identity = await ensureMachineIdentity(config, {
      machineId: "11111111-1111-4111-8111-111111111111",
    });
    const backup = await createPortabilityBackup(vault, config, identity, "knowledge", {
      gitCommit: "abcdef0",
    });
    expect(backup.manifest.appVersion).toBe(APP_VERSION);
  });
});

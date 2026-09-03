import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const servers: Server[] = [];
const POWERSHELL_PROCESS_TIMEOUT_MS = 30_000;
const POWERSHELL_TEST_TIMEOUT_MS = 35_000;
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function launcherFixture(options: { envText?: string; packageJson?: boolean; vault?: boolean; bom?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-launcher-")); roots.push(root);
  const scripts = path.join(root, "scripts"); const bin = path.join(root, "bin"); const vault = path.join(root, "vault"); const log = path.join(root, "npm.log");
  await Promise.all([mkdir(scripts), mkdir(bin), mkdir(path.join(root, "node_modules")), ...(options.vault === false ? [] : [mkdir(vault)])]);
  await copyFile(path.join(process.cwd(), "scripts", "start-tubeknowledge.ps1"), path.join(scripts, "start-tubeknowledge.ps1"));
  if (options.packageJson !== false) await writeFile(path.join(root, "package.json"), "{}\n", "utf8");
  if (options.vault !== false) await writeFile(path.join(vault, "INDEX.md"), "# Index\n", "utf8");
  await writeFile(path.join(bin, "node.cmd"), "@echo off\r\necho v20.9.0\r\nexit /b 0\r\n", "utf8");
  await writeFile(path.join(bin, "npm.cmd"), "@echo off\r\necho %*^|runtime=%TUBEKNOWLEDGE_RUNTIME_PATH%^|python=%TUBEKNOWLEDGE_PYTHON_PATH%>>\"%TK_LAUNCH_LOG%\"\r\nexit /b 0\r\n", "utf8");
  if (options.envText !== undefined) await writeFile(path.join(root, ".env.local"), `${options.bom ? "\uFEFF" : ""}${options.envText}`, "utf8");
  return { root, vault, log, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, TK_LAUNCH_LOG: log } };
}

function run(root: string, environment: NodeJS.ProcessEnv, args: string[] = [], clearLibrary = true) {
  const env = { ...environment };
  if (clearLibrary) delete env.YOUTUBE_LIBRARY_PATH;
  return spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "start-tubeknowledge.ps1"), ...args], { cwd: root, env, encoding: "utf8", timeout: POWERSHELL_PROCESS_TIMEOUT_MS });
}

function runWithBrowserCapture(root: string, environment: NodeJS.ProcessEnv, port: number, browserLog: string) {
  const command = "function Start-Job { param([scriptblock]$ScriptBlock, [object[]]$ArgumentList); [IO.File]::WriteAllText($env:TK_BROWSER_LOG, [string]$ArgumentList[0]); [pscustomobject]@{ Id = 1 } }; & $env:TK_LAUNCH_SCRIPT -OpenBrowser -Port $env:TK_TEST_PORT";
  const env: NodeJS.ProcessEnv = { ...environment, TK_BROWSER_LOG: browserLog, TK_LAUNCH_SCRIPT: path.join(root, "scripts", "start-tubeknowledge.ps1"), TK_TEST_PORT: String(port) };
  delete env.YOUTUBE_LIBRARY_PATH;
  return spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], { cwd: root, env, encoding: "utf8", timeout: POWERSHELL_PROCESS_TIMEOUT_MS });
}

async function occupiedPort(): Promise<number> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Port de test indisponible.");
  return address.port;
}

describe.runIf(process.platform === "win32")("lanceur Windows", { timeout: POWERSHELL_TEST_TIMEOUT_MS }, () => {
  it("utilise 3100 par défaut et préfère la variable du processus", async () => {
    const f = await launcherFixture({ envText: "YOUTUBE_LIBRARY_PATH=C:\\invalide\n" });
    const result = run(f.root, { ...f.env, YOUTUBE_LIBRARY_PATH: f.vault }, ["-Production"], false);
    expect(result.status).toBe(0); expect(await readFile(f.log, "utf8")).toContain("run start -- --hostname 127.0.0.1 --port 3100");
  });
  it("lit le fallback UTF-8 BOM, commentaires, lignes vides et guillemets sans afficher de secret", async () => {
    const f = await launcherFixture();
    await writeFile(path.join(f.root, ".env.local"), `\uFEFF# fixture\n\nYOUTUBE_LIBRARY_PATH="${f.vault}"\nOPENAI_API_KEY=ne-jamais-afficher\n`, "utf8");
    const result = run(f.root, f.env, ["-OpenBrowser"]);
    expect(result.status).toBe(0); expect(await readFile(f.log, "utf8")).toContain("run dev -- --hostname 127.0.0.1 --port 3100"); expect(`${result.stdout}${result.stderr}`).not.toContain("ne-jamais-afficher");
  });
  it("propage les chemins runtime et Python autorisés depuis .env.local", async () => {
    const f = await launcherFixture();
    const runtime = path.join(f.root, "runtime avec espaces");
    const python = path.join(f.root, ".venv-transcription", "Scripts", "python.exe");
    await writeFile(path.join(f.root, ".env.local"), `YOUTUBE_LIBRARY_PATH=${f.vault}\nTUBEKNOWLEDGE_RUNTIME_PATH=${runtime}\nTUBEKNOWLEDGE_PYTHON_PATH=${python}\n`, "utf8");
    const result = run(f.root, f.env);
    expect(result.status).toBe(0);
    const log = await readFile(f.log, "utf8");
    expect(log).toContain(`runtime=${runtime}`);
    expect(log).toContain(`python=${python}`);
  });
  it("retourne des erreurs humaines pour configuration, vault et projet absents", async () => {
    const missing = await launcherFixture(); const noEnv = run(missing.root, missing.env); expect(noEnv.status).toBe(20); expect(noEnv.stderr).toContain("n’est défini ni dans PowerShell ni dans .env.local"); expect(noEnv.stderr).not.toContain("Ã");
    const absentVault = await launcherFixture({ envText: "YOUTUBE_LIBRARY_PATH=C:\\absent\n" }); expect(run(absentVault.root, absentVault.env).status).toBe(22);
    const noPackage = await launcherFixture({ packageJson: false, envText: `YOUTUBE_LIBRARY_PATH=${missing.vault}\n` }); expect(run(noPackage.root, noPackage.env).status).toBe(5);
  });

  it("transmet un port explicite et annonce exactement son URL", async () => {
    const f = await launcherFixture();
    await writeFile(path.join(f.root, ".env.local"), `YOUTUBE_LIBRARY_PATH=${f.vault}\n`, "utf8");
    const result = run(f.root, f.env, ["-Port", "43100"]);
    expect(result.status).toBe(0);
    expect(await readFile(f.log, "utf8")).toContain("run dev -- --hostname 127.0.0.1 --port 43100");
    expect(result.stdout).toContain("http://127.0.0.1:43100");
  });

  it("ouvre exactement l’URL locale demandée", async () => {
    const f = await launcherFixture();
    await writeFile(path.join(f.root, ".env.local"), `YOUTUBE_LIBRARY_PATH=${f.vault}\n`, "utf8");
    const browserLog = path.join(f.root, "browser.log");
    const result = runWithBrowserCapture(f.root, f.env, 43101, browserLog);
    expect(result.status).toBe(0);
    expect(await readFile(browserLog, "utf8")).toBe("http://127.0.0.1:43101");
  });

  it("refuse les ports hors plage avant le lancement", async () => {
    const f = await launcherFixture({ envText: "YOUTUBE_LIBRARY_PATH=C:\\absent\n" });
    const result = run(f.root, f.env, ["-Port", "0"]);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.status, output).not.toBe(0);
    expect(output).toContain("ParameterArgumentValidationError");
    expect(output).toMatch(/\bPort\b/);
    await expect(readFile(f.log, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuse un port occupé avec une action suggérée", async () => {
    const f = await launcherFixture();
    await writeFile(path.join(f.root, ".env.local"), `YOUTUBE_LIBRARY_PATH=${f.vault}\n`, "utf8");
    const port = await occupiedPort();
    const result = run(f.root, f.env, ["-Port", String(port)]);
    expect(result.status).toBe(30);
    expect(result.stderr).toContain(`Le port ${port} est déjà occupé.`);
    expect(result.stderr).toContain("-Port <port-libre>");
    await expect(readFile(f.log, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});

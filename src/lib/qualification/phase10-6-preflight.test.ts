import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-phase10-6-preflight-")); roots.push(root);
  const scripts = path.join(root, "scripts"); const bin = path.join(root, "bin"); const vault = path.join(root, "vault"); const runtime = path.join(root, "runtime");
  await Promise.all([mkdir(scripts), mkdir(bin), mkdir(vault), mkdir(runtime)]);
  await copyFile(path.resolve("scripts/phase10-6-preflight.ps1"), path.join(scripts, "phase10-6-preflight.ps1"));
  await writeFile(path.join(vault, "INDEX.md"), "# Fixture\n", "utf8");
  await writeFile(path.join(bin, "node.cmd"), "@echo v20.9.0\r\n", "ascii");
  await writeFile(path.join(bin, "npm.cmd"), "@echo 10.9.0\r\n", "ascii");
  await writeFile(path.join(bin, "git.cmd"), "@echo off\r\nif \"%1 %2\"==\"rev-parse --is-inside-work-tree\" echo true\r\nif \"%1 %2\"==\"status --short\" if not \"%TK_FAKE_DIRTY%\"==\"\" echo M fixture.txt\r\nexit /b 0\r\n", "ascii");
  const python = path.join(bin, "python.cmd");
  await writeFile(python, "@echo off\r\nif \"%1\"==\"--version\" echo Python 3.12.10\r\nif \"%1 %2 %3\"==\"-m yt_dlp --version\" echo 2026.7.4\r\nexit /b 0\r\n", "ascii");
  const ffmpeg = path.join(bin, "ffmpeg.cmd"); await writeFile(ffmpeg, "@echo ffmpeg version fixture\r\n", "ascii");
  const secret = "secret-ne-jamais-afficher";
  return { root, vault, runtime, secret, env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, YOUTUBE_LIBRARY_PATH: vault, TUBEKNOWLEDGE_RUNTIME_PATH: runtime, TUBEKNOWLEDGE_PYTHON_PATH: python, TUBEKNOWLEDGE_FFMPEG_PATH: ffmpeg, OPENAI_API_KEY: secret } };
}

function run(root: string, env: NodeJS.ProcessEnv, port: number) {
  const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "scripts", "phase10-6-preflight.ps1"), "-Port", String(port)], { cwd: root, env, windowsHide: true });
    let output = ""; child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); }); child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8"); });
    child.once("error", reject); child.once("close", (code) => resolve({ code, output }));
  });
}

async function httpFixture(validHealth: boolean, host = "127.0.0.1", ipv6Only = false) {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/health") response.end(JSON.stringify(validHealth ? { status: "ok", schemaVersion: 1 } : { service: "other" }));
    else if (request.url === "/api/diagnostics") response.end(JSON.stringify({ status: "safe-fixture" }));
    else { response.statusCode = 404; response.end("{}"); }
  });
  servers.push(server); await new Promise<void>((resolve, reject) => server.listen({ port: 0, host, ipv6Only }, resolve).once("error", reject));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Port HTTP indisponible."); return address.port;
}

describe.runIf(process.platform === "win32")("préflight Phase 10.6", () => {
  it("retourne PASS avec outils factices et API TubeKnowledge sûre", async () => {
    const f = await fixture(); const result = await run(f.root, f.env, await httpFixture(true));
    expect(result.code, result.output).toBe(0); expect(result.output).toContain("FAIL=0"); expect(result.output).toContain("Santé API"); expect(result.output).toContain("Diagnostic API");
    expect(result.output).not.toContain(f.root); expect(result.output).not.toContain(f.secret); expect(result.output).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i);
  }, 15_000);

  it("interroge une instance dual-stack avant de déclarer le port IPv4 disponible", async () => {
    const f = await fixture();
    const port = await httpFixture(true, "::");
    const result = await run(f.root, f.env, port);
    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain("[PASS] Santé API");
    expect(result.output).toContain("[PASS] Diagnostic API");
    expect(result.output).not.toContain("Le port demandé est disponible.");
    expect(result.output).not.toContain("Le serveur n'est pas lancé");
  }, 15_000);

  it("avertit pour un dépôt sale sans échouer", async () => {
    const f = await fixture(); const result = await run(f.root, { ...f.env, TK_FAKE_DIRTY: "1" }, await httpFixture(true));
    expect(result.code, result.output).toBe(0); expect(result.output).toContain("[WARN] Dépôt");
  }, 15_000);

  it("échoue si le port appartient à un autre service", async () => {
    const f = await fixture(); const result = await run(f.root, f.env, await httpFixture(false));
    expect(result.code).toBe(1); expect(result.output).toContain("[FAIL] Port"); expect(result.output).not.toContain(f.vault);
  }, 15_000);

  it("échoue si le port est occupé uniquement sur la boucle IPv6", async () => {
    const f = await fixture(); const result = await run(f.root, f.env, await httpFixture(false, "::1", true));
    expect(result.code).toBe(1); expect(result.output).toContain("[FAIL] Port");
    expect(result.output).not.toContain("Le port demandé est disponible.");
  }, 15_000);

  it("échoue sans bibliothèque et ne révèle aucune configuration", async () => {
    const f = await fixture(); const env = { ...f.env, YOUTUBE_LIBRARY_PATH: "" }; const result = await run(f.root, env, await httpFixture(true));
    expect(result.code).toBe(1); expect(result.output).toContain("[FAIL] Bibliothèque"); expect(result.output).not.toContain(f.secret);
  }, 15_000);

  it("est livré en UTF-8 BOM et ne contient aucune opération destructive", async () => {
    const bytes = await readFile(path.resolve("scripts/phase10-6-preflight.ps1")); const source = bytes.toString("utf8");
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); expect(source).not.toMatch(/npm(?:\.cmd)?\s+(?:ci|install)|renewWriter|reacquire|createPortabilityBackup|Remove-Item/i);
  });
});

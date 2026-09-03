import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }))); });

describe.runIf(process.platform === "win32")("setup Python fail-fast", () => {
  it("distingue un launcher sans runtime et ne tente jamais le venv", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tk-setup-")); roots.push(root);
    const scripts = path.join(root, "scripts"); const fakeBin = path.join(root, "fake-bin");
    await mkdir(path.join(root, "transcription-worker"), { recursive: true }); await mkdir(scripts); await mkdir(fakeBin);
    await copyFile(path.resolve("scripts/setup-transcription.ps1"), path.join(scripts, "setup-transcription.ps1"));
    await writeFile(path.join(root, "transcription-worker", "requirements.txt"), "", "utf8");
    await writeFile(path.join(fakeBin, "py.cmd"), "@echo launcher sans runtime 1>&2\r\n@exit /b 1\r\n", "ascii");
    const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const result = await run(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(scripts, "setup-transcription.ps1")], { ...process.env, PATH: fakeBin });
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.code, output).not.toBe(0);
    expect(output).toContain("launcher py détecté, mais aucun runtime Python 3.12 utilisable");
    expect(output).toContain("winget install -e --id Python.Python.3.12");
    expect(output.match(/ERREUR -/g)).toHaveLength(1);
    expect(output).not.toContain("n’est pas reconnu comme nom");
    expect(output).not.toContain("dÃ©tect");
    await expect(stat(path.join(root, ".venv-transcription"))).rejects.toMatchObject({ code: "ENOENT" });
    const bytes = await readFile(path.join(scripts, "setup-transcription.ps1"));
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  }, 15_000);

  it("utilise truststore avec un pip récent et des imports disponibles", async () => {
    const fixture = await setupFixture();
    const fakePython = await fakeVenvPython(fixture.root);
    const log = path.join(fixture.root, "python-invocations.txt");
    const result = await run(fixture.powershell, [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture.script,
      "-VenvPythonExecutable", fakePython,
    ], environmentWithoutPipUseFeature({ FAKE_PYTHON_LOG: log }));
    const output = `${result.stdout}\n${result.stderr}`;
    const invocationLog = await readFile(log, "utf8");
    expect(result.code, `${output}\n${invocationLog}`).toBe(0);
    expect(output).toContain("OK - environnement Python prêt");
    const pipInvocations = invocationLog.split(/\r?\n/).filter((line) => line.includes("ARGS=-m pip install"));
    expect(pipInvocations).toHaveLength(3);
    expect(pipInvocations.every((line) => line.includes("PIP_USE_FEATURE=truststore") && line.includes("--use-feature=truststore"))).toBe(true);
    expect(invocationLog).not.toContain("ARGS=-m ensurepip");
  }, 15_000);

  it("reprend un venv incomplet et vérifie les imports après installation", async () => {
    const fixture = await setupFixture();
    const fakePython = await fakeVenvPython(fixture.root, false, true);
    const marker = path.join(fixture.root, "imports-installed.txt");
    const result = await run(fixture.powershell, [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture.script,
      "-VenvPythonExecutable", fakePython,
    ], environmentWithoutPipUseFeature({ FAKE_INSTALL_MARKER: marker }));
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.code, output).toBe(0);
    expect(output).toContain("le venv existe mais est incomplet");
    expect(output).toContain("OK - environnement Python prêt");
    await expect(stat(marker)).resolves.toBeDefined();
  }, 15_000);

  it("bootstrappe un pip ancien avec ensurepip avant toute installation r\u00e9seau", async () => {
    const fixture = await setupFixture();
    const fakePython = await fakeVenvPython(fixture.root);
    const log = path.join(fixture.root, "python-invocations.txt");
    const versionFile = path.join(fixture.root, "pip-version.txt");
    await writeFile(versionFile, "22.1", "ascii");
    const result = await run(fixture.powershell, [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture.script,
      "-VenvPythonExecutable", fakePython,
    ], environmentWithoutPipUseFeature({ FAKE_PIP_VERSION_FILE: versionFile, FAKE_ENSUREPIP_VERSION: "22.2", FAKE_PYTHON_LOG: log }));
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.code, output).toBe(0);
    expect(output).toContain("bootstrap hors ligne avec ensurepip");
    expect(output).toContain("pip 22.2 compatible avec truststore");
    const invocations = await readFile(log, "utf8");
    expect(invocations).toContain("ARGS=-m ensurepip --upgrade");
    expect(invocations.split(/\r?\n/).filter((line) => line.includes("ARGS=-m pip install"))).toHaveLength(3);
  }, 15_000);

  it("arr\u00eate avant pip si ensurepip ne fournit pas la version minimale", async () => {
    const fixture = await setupFixture();
    const fakePython = await fakeVenvPython(fixture.root);
    const log = path.join(fixture.root, "python-invocations.txt");
    const versionFile = path.join(fixture.root, "pip-version.txt");
    await writeFile(versionFile, "22.1", "ascii");
    const result = await run(fixture.powershell, [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture.script,
      "-VenvPythonExecutable", fakePython,
    ], environmentWithoutPipUseFeature({ FAKE_PIP_VERSION_FILE: versionFile, FAKE_ENSUREPIP_VERSION: "22.1", FAKE_PYTHON_LOG: log }));
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.code, output).not.toBe(0);
    expect(output).toContain("pip 22.2 ou plus récent est requis");
    expect(output).toContain("distribution Python maintenue");
    const invocations = await readFile(log, "utf8");
    expect(invocations).toContain("ARGS=-m ensurepip --upgrade");
    expect(invocations).not.toContain("ARGS=-m pip install");
  }, 15_000);

  it("pr\u00e9serve les features pip existantes et propage truststore au build isol\u00e9", async () => {
    const fixture = await setupFixture();
    const fakePython = await fakeVenvPython(fixture.root);
    const log = path.join(fixture.root, "python-invocations.txt");
    const childLog = path.join(fixture.root, "build-child.txt");
    const result = await run(fixture.powershell, [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture.script,
      "-VenvPythonExecutable", fakePython,
    ], environmentWithoutPipUseFeature({ PIP_USE_FEATURE: "fast-deps", FAKE_PYTHON_LOG: log, FAKE_CHILD_LOG: childLog, FAKE_BUILD_CHILD: fixture.buildChild }));
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.code, output).toBe(0);
    expect(output).toContain("magasin de certificats syst\u00e8me Windows");
    const pipInvocations = (await readFile(log, "utf8")).split(/\r?\n/).filter((line) => line.includes("ARGS=-m pip install"));
    expect(pipInvocations).toHaveLength(3);
    expect(pipInvocations.every((line) => line.includes("PIP_USE_FEATURE=fast-deps truststore") && line.includes("--use-feature=truststore"))).toBe(true);
    const childInvocations = await readFile(childLog, "utf8");
    expect(childInvocations).toContain("CHILD_PIP_USE_FEATURE=fast-deps truststore");
    expect(childInvocations).toContain("ARGS=-m pip install --use-feature=truststore --editable");
    const script = await readFile(fixture.script, "utf8");
    expect(script).not.toMatch(/trusted-host|http:|no-verify/i);
  }, 15_000);

  it("échoue si les imports restent absents après des installations réussies", async () => {
    const fixture = await setupFixture();
    const fakePython = await fakeVenvPython(fixture.root, true);
    const result = await run(fixture.powershell, [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixture.script,
      "-VenvPythonExecutable", fakePython,
    ], environmentWithoutPipUseFeature());
    const output = `${result.stdout}\n${result.stderr}`;
    expect(result.code, output).not.toBe(0);
    expect(output).toContain("le venv existe mais est incomplet");
    expect(output).toContain("imports impossibles après installation");
    expect(output).not.toContain("OK - environnement Python prêt");
    expect(output.match(/ERREUR -/g)).toHaveLength(1);
  }, 15_000);
});

async function setupFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tk-setup-existing-")); roots.push(root);
  const scripts = path.join(root, "scripts");
  await mkdir(path.join(root, "transcription-worker"), { recursive: true });
  await mkdir(scripts);
  const script = path.join(scripts, "setup-transcription.ps1");
  const buildChild = path.join(root, "fake-build-child.cmd");
  await copyFile(path.resolve("scripts/setup-transcription.ps1"), script);
  await writeFile(path.join(root, "transcription-worker", "requirements.txt"), "", "utf8");
  await writeFile(buildChild, "@echo off\r\nif not \"%FAKE_CHILD_LOG%\"==\"\" echo CHILD_PIP_USE_FEATURE=%PIP_USE_FEATURE% ARGS=%*>>\"%FAKE_CHILD_LOG%\"\r\nexit /b 0\r\n", "ascii");
  return {
    root,
    script,
    buildChild,
    powershell: path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  };
}

async function fakeVenvPython(root: string, alwaysMissing = false, missingUntilInstall = false) {
  const scripts = path.join(root, ".venv-transcription", "Scripts");
  await mkdir(scripts, { recursive: true });
  const executable = path.join(scripts, "python.cmd");
  await writeFile(executable, [
    "@echo off",
    "if not \"%FAKE_PYTHON_LOG%\"==\"\" echo PIP_USE_FEATURE=%PIP_USE_FEATURE% ARGS=%*>>\"%FAKE_PYTHON_LOG%\"",
    "if \"%1\"==\"--version\" goto version",
    "if \"%1\"==\"-c\" goto import",
    "if \"%1\"==\"-m\" goto module",
    "exit /b 0",
    ":version",
    "echo Python 3.12.10",
    "exit /b 0",
    ":import",
    ...(alwaysMissing ? ["exit /b 1"] : missingUntilInstall ? [
      "if exist \"%FAKE_INSTALL_MARKER%\" exit /b 0",
      "exit /b 1",
    ] : ["exit /b 0"]),
    ":module",
    "if \"%2 %3\"==\"pip --version\" goto pipversion",
    "if \"%2\"==\"ensurepip\" goto ensurepip",
    "if \"%2\"==\"pip\" goto pip",
    "exit /b 0",
    ":pip",
    "if not \"%FAKE_BUILD_CHILD%\"==\"\" call \"%FAKE_BUILD_CHILD%\" %*",
    "goto install",
    ":pipversion",
    "set \"CURRENT_PIP=24.0\"",
    "if not \"%FAKE_PIP_VERSION_FILE%\"==\"\" set /p CURRENT_PIP=<\"%FAKE_PIP_VERSION_FILE%\"",
    "echo pip %CURRENT_PIP% from fake",
    "exit /b 0",
    ":ensurepip",
    "if not \"%FAKE_PIP_VERSION_FILE%\"==\"\" echo %FAKE_ENSUREPIP_VERSION%>\"%FAKE_PIP_VERSION_FILE%\"",
    "exit /b 0",
    ":install",
    "if not \"%FAKE_INSTALL_MARKER%\"==\"\" echo installed>\"%FAKE_INSTALL_MARKER%\"",
    "exit /b 0",
    "",
  ].join("\r\n"), "ascii");
  return executable;
}

function environmentWithoutPipUseFeature(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env } as NodeJS.ProcessEnv;
  delete environment.PIP_USE_FEATURE;
  Object.assign(environment, overrides);
  return environment;
}

function run(command: string, args: string[], environment: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: environment, shell: false, windowsHide: true });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

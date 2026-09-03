import { spawn } from "node:child_process";
import path from "node:path";

import { getTranscriptionConfig } from "./config";
import { listJobs, readLastWorkerFailureCode } from "./runtime";
import type { AcquisitionJob } from "./types";
import { runWorkerProcess } from "./worker-process";

export type ToolStatus = "OK" | "OPTIONNEL" | "MANQUANT" | "INCOMPATIBLE";
export interface DiagnosticItem { name: string; status: ToolStatus; detail: string }
export type ProbeResult = "ok" | "missing" | "incompatible";
export type CommandProbe = (command: string, args: string[], environment: NodeJS.ProcessEnv) => Promise<ProbeResult>;

export function summarizeRecentExecution(jobs: AcquisitionJob[], eventFailureCode?: string): { realExecution: "succeeded" | "failed" | "not-tested"; recentFailureCode?: string; item: DiagnosticItem } {
  const recent = [...jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const realExecution = recent?.status === "completed" ? "succeeded" : recent && ["failed", "interrupted"].includes(recent.status) ? "failed" : "not-tested";
  const persistedCode = recent?.error?.code;
  const recentFailureCode = realExecution === "failed" ? (persistedCode && persistedCode !== "WORKER_FAILED" ? persistedCode : eventFailureCode ?? persistedCode ?? "TRANSCRIPTION_INTERRUPTED") : undefined;
  const item = realExecution === "succeeded"
    ? { name: "Dernier traitement réel", status: "OK" as const, detail: "Une acquisition réelle terminée est persistée dans le runtime local." }
    : realExecution === "failed"
      ? { name: "Dernier traitement réel", status: "INCOMPATIBLE" as const, detail: `Échec récent enregistré (${recentFailureCode}). Les outils restent disponibles, mais le parcours réel n’est pas validé.` }
      : { name: "Dernier traitement réel", status: "OPTIONNEL" as const, detail: "Non effectué; la disponibilité des outils ne prouve pas un accès YouTube fonctionnel." };
  return { realExecution, recentFailureCode, item };
}

export async function inspectTranscriptionHealth(
  environment: NodeJS.ProcessEnv = process.env,
  probe: CommandProbe = commandProbe,
): Promise<{ status: "available" | "incomplete" | "recent-failure"; realExecution: "succeeded" | "failed" | "not-tested"; recentFailureCode?: string; cpuFirst: true; items: DiagnosticItem[] }> {
  let config;
  try { config = getTranscriptionConfig(environment); }
  catch {
    return {
      status: "incomplete", realExecution: "not-tested", cpuFirst: true,
      items: [
        { name: "Configuration", status: "INCOMPATIBLE", detail: "Le runtime doit être un chemin absolu hors du vault et de OneDrive." },
        { name: "CPU", status: "OK", detail: "Profil CPU/int8 disponible par défaut." },
        { name: "NVIDIA/CUDA", status: "OPTIONNEL", detail: "Non requis pour le mode CPU." },
      ],
    };
  }

  const configuredPython = environment.TUBEKNOWLEDGE_PYTHON_PATH?.trim();
  const venvPython = path.join(/* turbopackIgnore: true */ process.cwd(), ".venv-transcription", "Scripts", "python.exe");
  const activePython = configuredPython || venvPython;
  const [configuredResult, launcherResult, globalResult, venvResult, ffmpegResult, ffprobeResult, nvidiaResult] = await Promise.all([
    configuredPython ? probe(configuredPython, ["--version"], environment) : Promise.resolve<ProbeResult>("missing"),
    probe("py", ["-3.12", "--version"], environment),
    probe("python", ["--version"], environment),
    probe(venvPython, ["--version"], environment),
    probe(config.ffmpegPath, ["-version"], environment),
    probe(config.ffprobePath, ["-version"], environment),
    probe("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], environment),
  ]);
  const activeResult = configuredPython ? configuredResult : venvResult;
  const items: DiagnosticItem[] = [
    configuredPython
      ? diagnostic("Python configuré", configuredResult, "Interpréteur configuré exécutable.", "Exécutable configuré introuvable.", "L’exécutable configuré ne réussit pas --version.")
      : { name: "Python configuré", status: "OPTIONNEL", detail: "Aucun TUBEKNOWLEDGE_PYTHON_PATH explicite." },
    diagnostic("Launcher py", launcherResult, "Launcher et runtime Python 3.12 disponibles.", "Launcher py absent.", "Launcher présent, mais aucun runtime Python 3.12 utilisable."),
    diagnostic("Runtime global", globalResult, "La commande python réussit --version.", "Commande python absente.", "La commande python existe, mais --version échoue."),
    diagnostic("venv", venvResult, ".venv-transcription exécute --version.", ".venv-transcription absent.", "Le venv existe, mais son Python ne s’exécute pas."),
    diagnostic("Python actif", activeResult, "Le Python utilisé par l’application est exécutable.", "Le Python utilisé par l’application est introuvable.", "Le Python utilisé par l’application ne réussit pas --version."),
  ];

  let workerItems: DiagnosticItem[] = [];
  if (activeResult === "ok") {
    try {
      const runner = runWorkerProcess(activePython, ["-m", "tubeknowledge_worker.cli", "health", "--job-dir", config.runtimePath], {
        cwd: path.join(/* turbopackIgnore: true */ process.cwd(), "transcription-worker"),
        timeoutMs: 15_000,
        unavailableCode: "PYTHON_RUNTIME_UNAVAILABLE",
        environment: { ...environment, PYTHONUTF8: "1", TUBEKNOWLEDGE_FFMPEG_PATH: config.ffmpegPath, TUBEKNOWLEDGE_FFPROBE_PATH: config.ffprobePath },
        onEvent: () => undefined,
      });
      const result = await runner.promise;
      const reported = Array.isArray(result.result.items) ? result.result.items.filter(isDiagnosticItem) : [];
      workerItems = [
        reported.find((item) => item.name === "yt-dlp")?.status === "OK"
          ? { name: "yt-dlp", status: "OK", detail: "Module importable avec le Python actif; ce diagnostic n’effectue aucun appel réseau." }
          : { name: "yt-dlp", status: "MANQUANT", detail: "Module non confirmé." },
        reported.find((item) => item.name === "faster-whisper")?.status === "OK"
          ? { name: "faster-whisper", status: "OK", detail: "Module importable avec le Python actif; aucun modèle n’est chargé par ce diagnostic." }
          : { name: "faster-whisper", status: "MANQUANT", detail: "Module non confirmé." },
        { name: "worker", status: "OK", detail: "Le module worker est importable et son protocole répond." },
      ];
    } catch (error) {
      console.error("[TubeKnowledge transcription health]", error);
      workerItems = [
        { name: "yt-dlp", status: "MANQUANT", detail: "Module non confirmé par le worker." },
        { name: "faster-whisper", status: "MANQUANT", detail: "Module non confirmé par le worker." },
        { name: "worker", status: "MANQUANT", detail: "Le worker n’est pas importable avec le Python actif." },
      ];
    }
  } else {
    workerItems = [
      { name: "yt-dlp", status: "MANQUANT", detail: "Python actif indisponible." },
      { name: "faster-whisper", status: "MANQUANT", detail: "Python actif indisponible." },
      { name: "worker", status: "MANQUANT", detail: "Python actif indisponible." },
    ];
  }

  items.push(
    ...workerItems,
    diagnostic("FFmpeg", ffmpegResult, "Exécutable disponible.", "Installation manuelle requise.", "L’exécutable ne réussit pas -version."),
    diagnostic("ffprobe", ffprobeResult, "Exécutable disponible.", "Installation manuelle requise.", "L’exécutable ne réussit pas -version."),
    { name: "CPU", status: "OK", detail: "Profil CPU/int8 disponible par défaut." },
    nvidiaResult === "ok"
      ? { name: "NVIDIA/CUDA", status: "OK", detail: "GPU NVIDIA détecté; utilisation facultative." }
      : { name: "NVIDIA/CUDA", status: "OPTIONNEL", detail: "Non détecté; utilisez le CPU." },
  );
  const requiredNames = new Set(["Python actif", "yt-dlp", "faster-whisper", "worker", "FFmpeg", "ffprobe", "CPU"]);
  const available = items.filter((item) => requiredNames.has(item.name)).every((item) => item.status === "OK");
  const jobs = await listJobs(config).catch(() => []);
  const latestJob = [...jobs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const eventFailureCode = latestJob && ["failed", "interrupted"].includes(latestJob.status)
    ? await readLastWorkerFailureCode(config, latestJob.id).catch(() => undefined)
    : undefined;
  const { realExecution, recentFailureCode, item } = summarizeRecentExecution(jobs, eventFailureCode);
  items.push(item);
  return { status: !available ? "incomplete" : realExecution === "failed" ? "recent-failure" : "available", realExecution, recentFailureCode, cpuFirst: true, items };
}

function diagnostic(name: string, result: ProbeResult, ok: string, missing: string, incompatible: string): DiagnosticItem {
  if (result === "ok") return { name, status: "OK", detail: ok };
  if (result === "missing") return { name, status: "MANQUANT", detail: missing };
  return { name, status: "INCOMPATIBLE", detail: incompatible };
}

async function commandProbe(command: string, args: string[], environment: NodeJS.ProcessEnv): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: ProbeResult) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } };
    const child = spawn(command, args, { env: environment, shell: false, windowsHide: true, stdio: "ignore" });
    const timer = setTimeout(() => { child.kill(); finish("incompatible"); }, 3_000);
    child.once("error", (error: NodeJS.ErrnoException) => finish(error.code === "ENOENT" ? "missing" : "incompatible"));
    child.once("exit", (code) => finish(code === 0 ? "ok" : "incompatible"));
  });
}

function isDiagnosticItem(value: unknown): value is DiagnosticItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.name === "string" && typeof item.detail === "string" && ["OK", "OPTIONNEL", "MANQUANT", "INCOMPATIBLE"].includes(String(item.status));
}


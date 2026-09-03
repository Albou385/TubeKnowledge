"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { AcquisitionJob, SubtitleTrack } from "@/lib/transcription/types";
import { clientErrorMessage } from "@/lib/transcription/client-errors";
import type { PublicTranscriptionErrorPayload } from "@/lib/transcription/error-catalog";

const DEFAULT_ORDER = ["fr-CA", "fr", "en-CA", "en"];

export function AcquisitionWorkbench() {
  const router = useRouter();
  const [tab, setTab] = useState<"youtube" | "upload">("youtube");
  const [job, setJob] = useState<AcquisitionJob | null>(null);
  const [languages, setLanguages] = useState(DEFAULT_ORDER);
  const [selection, setSelection] = useState("whisper");
  const [profile, setProfile] = useState<"fast" | "balanced" | "quality">("fast");
  const [device, setDevice] = useState<"cpu" | "cuda">("cpu");
  const [language, setLanguage] = useState("");
  const [keepAudio, setKeepAudio] = useState(false);
  const [confirmModel, setConfirmModel] = useState(false);
  const [confirmQuality, setConfirmQuality] = useState(false);
  const [confirmLong, setConfirmLong] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const tracks = useMemo(() => sortTracks(job?.inspection?.subtitles ?? [], languages), [job, languages]);

  async function inspect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setJob(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/acquisitions/inspect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: form.get("url") }) });
      const payload = await response.json() as { job?: AcquisitionJob; error?: PublicTranscriptionErrorPayload };
      if (!response.ok || !payload.job) { setError(clientErrorMessage(payload.error, "Inspection impossible.")); return; }
      setJob(payload.job);
      const first = sortTracks(payload.job.inspection?.subtitles ?? [], languages)[0];
      if (first) setSelection(trackValue(first));
    } catch { setError("Inspection impossible."); }
    finally { setBusy(false); }
  }

  async function start() {
    if (!job) return;
    setBusy(true); setError("");
    try {
      const selectedTrack = tracks.find((track) => trackValue(track) === selection);
      const source = selectedTrack ? { kind: "subtitles", language: selectedTrack.language, origin: selectedTrack.origin, format: selectedTrack.formats[0].extension } : {
        kind: "whisper", profile, language: language || undefined, device, computeType: "int8", confirmModelDownload: confirmModel,
        confirmQuality, confirmLongVideo: confirmLong, keepAudio,
      };
      const response = await fetch("/api/acquisitions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: job.id, source }) });
      const payload = await response.json() as { job?: AcquisitionJob; error?: PublicTranscriptionErrorPayload };
      if (!response.ok || !payload.job) { setError(clientErrorMessage(payload.error, "Démarrage impossible.")); setBusy(false); return; }
      router.push(`/acquisitions/${job.id}`);
    } catch { setError("Démarrage impossible."); setBusy(false); }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/acquisitions/upload", { method: "POST", body: new FormData(event.currentTarget) });
      const payload = await response.json() as { job?: AcquisitionJob; error?: PublicTranscriptionErrorPayload };
      if (!response.ok || !payload.job) { setError(clientErrorMessage(payload.error, "Import impossible.")); setBusy(false); return; }
      router.push(`/acquisitions/${payload.job.id}`);
    } catch { setError("Import impossible."); setBusy(false); }
  }

  function moveLanguage(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= languages.length) return;
    const next = [...languages]; [next[index], next[target]] = [next[target], next[index]]; setLanguages(next);
  }

  return <div className="space-y-6">
    <div role="tablist" className="flex gap-2 rounded-xl bg-slate-200 p-1 dark:bg-slate-900"><button type="button" role="tab" aria-selected={tab === "youtube"} onClick={() => setTab("youtube")} className={`flex-1 rounded-lg px-4 py-3 font-semibold ${tab === "youtube" ? "bg-white text-cyan-800 dark:bg-slate-800 dark:text-cyan-300" : "text-slate-500"}`}>URL YouTube</button><button type="button" role="tab" aria-selected={tab === "upload"} onClick={() => setTab("upload")} className={`flex-1 rounded-lg px-4 py-3 font-semibold ${tab === "upload" ? "bg-white text-cyan-800 dark:bg-slate-800 dark:text-cyan-300" : "text-slate-500"}`}>Importer une transcription</button></div>
    {error ? <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</p> : null}
    {tab === "youtube" ? <>
      <form onSubmit={inspect} className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><label htmlFor="youtube-url" className="font-semibold">URL publique de la vidéo</label><div className="mt-3 flex flex-col gap-3 sm:flex-row"><input id="youtube-url" name="url" type="url" required placeholder="https://www.youtube.com/watch?v=…" className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-transparent p-3 dark:border-slate-700" /><button disabled={busy} className="rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? "Inspection…" : "Inspecter sans télécharger"}</button></div><p className="mt-3 text-xs text-slate-500">HTTPS YouTube uniquement. Les playlists, chaînes, recherches et directs en cours sont refusés.</p></form>
      {job?.inspection ? <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div><p className="text-sm text-cyan-700 dark:text-cyan-300">{job.inspection.videoId} · {formatDuration(job.inspection.durationSeconds)}</p><h2 className="mt-1 text-2xl font-bold">{job.inspection.title}</h2></div>
        {job.inspection.warnings.map((warning) => <p key={warning.code} className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{warning.message}</p>)}
        <fieldset><legend className="font-semibold">Ordre de préférence des langues</legend><div className="mt-2 flex flex-wrap gap-2">{languages.map((item, index) => <span key={item} className="inline-flex items-center rounded-lg bg-slate-100 px-2 py-1 text-sm dark:bg-slate-800">{item}<button type="button" aria-label={`Monter ${item}`} onClick={() => moveLanguage(index, -1)} className="ml-2 px-1">↑</button><button type="button" aria-label={`Descendre ${item}`} onClick={() => moveLanguage(index, 1)} className="px-1">↓</button></span>)}</div></fieldset>
        <fieldset className="space-y-2"><legend className="font-semibold">Source</legend>{tracks.map((track) => <label key={trackValue(track)} className="flex gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"><input type="radio" name="source" checked={selection === trackValue(track)} onChange={() => setSelection(trackValue(track))} /><span><strong>{track.origin === "manual" ? "Manuels" : "Automatiques"} · {track.language}</strong><small className="ml-2 text-slate-500">{track.formats.map((item) => item.extension.toUpperCase()).join(", ")}</small></span></label>)}<label className="flex gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700"><input type="radio" name="source" checked={selection === "whisper"} onChange={() => setSelection("whisper")} /><span><strong>Transcription locale faster-whisper</strong><small className="ml-2 text-slate-500">audio uniquement</small></span></label></fieldset>
        {selection === "whisper" ? <div className="grid gap-4 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 dark:bg-slate-950"><label>Profil<select value={profile} onChange={(event) => setProfile(event.target.value as typeof profile)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-950"><option value="fast">Rapide · small · CPU · int8</option><option value="balanced">Équilibré · medium · CPU · int8</option><option value="quality">Qualité · large-v3</option></select></label><label>Langue (vide = auto)<input value={language} onChange={(event) => setLanguage(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-950" placeholder="fr" /></label>{profile === "quality" ? <label>Device<select value={device} onChange={(event) => setDevice(event.target.value as typeof device)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-slate-950"><option value="cpu">CPU</option><option value="cuda">NVIDIA CUDA</option></select></label> : null}<label className="flex items-center gap-2"><input type="checkbox" checked={keepAudio} onChange={(event) => setKeepAudio(event.target.checked)} /> Conserver l’audio après succès</label><label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={confirmModel} onChange={(event) => setConfirmModel(event.target.checked)} /> Je confirme le téléchargement éventuel du modèle dans le cache local hors OneDrive.</label>{profile === "quality" ? <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={confirmQuality} onChange={(event) => setConfirmQuality(event.target.checked)} /> Je confirme le profil Qualité, plus lourd.</label> : null}{job.inspection.durationSeconds > 7200 ? <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={confirmLong} onChange={(event) => setConfirmLong(event.target.checked)} /> Je confirme le traitement renforcé de cette vidéo de plus de 120 minutes.</label> : null}</div> : null}
        <button type="button" disabled={busy} onClick={start} className="rounded-xl bg-cyan-400 px-5 py-3 font-bold text-slate-950 disabled:opacity-50">Confirmer et démarrer</button>
      </section> : null}
    </> : <form onSubmit={upload} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"><div><label htmlFor="transcript-file" className="font-semibold">Fichier UTF-8</label><input id="transcript-file" name="file" type="file" accept=".txt,.md,.vtt,.srt" required className="mt-2 block w-full rounded-lg border border-slate-300 p-3 dark:border-slate-700" /><p className="mt-1 text-xs text-slate-500">Un fichier TXT, MD, VTT ou SRT · maximum 10 MiB</p></div><label className="block">Titre requis<input name="title" required maxLength={500} className="mt-1 block w-full rounded-lg border border-slate-300 bg-transparent p-3 dark:border-slate-700" /></label><label className="block">URL source facultative<input name="url" type="url" maxLength={2048} className="mt-1 block w-full rounded-lg border border-slate-300 bg-transparent p-3 dark:border-slate-700" /></label><button disabled={busy} className="rounded-xl bg-cyan-400 px-5 py-3 font-semibold text-slate-950 disabled:opacity-50">{busy ? "Import…" : "Importer et normaliser"}</button></form>}
  </div>;
}

function sortTracks(tracks: SubtitleTrack[], order: string[]): SubtitleTrack[] {
  const rank = (track: SubtitleTrack) => (track.origin === "manual" ? 0 : 100) + (order.indexOf(track.language) >= 0 ? order.indexOf(track.language) : 50);
  return [...tracks].sort((left, right) => rank(left) - rank(right) || left.language.localeCompare(right.language));
}
function trackValue(track: SubtitleTrack) { return `${track.origin}:${track.language}:${track.formats[0].extension}`; }
function formatDuration(seconds: number) { const minutes = Math.floor(seconds / 60); return `${Math.floor(minutes / 60)} h ${minutes % 60} min`; }

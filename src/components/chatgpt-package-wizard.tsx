"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import type { PackagePreviewRecord, StoredChatGptPackage } from "@/lib/chatgpt-packages/runtime";
import type { AcquisitionJob } from "@/lib/transcription/types";

interface Suggestion { relativePath: string; title: string; score: number; reason: string }

export function ChatGptPackageWizard({ acquisitions }: { acquisitions: AcquisitionJob[] }) {
  const router = useRouter();
  const search = useSearchParams();
  const initialId = search.get("acquisitionId") ?? acquisitions[0]?.id ?? "";
  const workflowId = search.get("workflowId");
  const [acquisitionId, setAcquisitionId] = useState(initialId);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [manualSearch, setManualSearch] = useState("");
  const [structural, setStructural] = useState(false);
  const [preview, setPreview] = useState<PackagePreviewRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestInFlight = useRef(false);
  const visibleFiles = useMemo(() => available.filter((file) => file.toLocaleLowerCase("fr").includes(manualSearch.toLocaleLowerCase("fr"))).slice(0, 30), [available, manualSearch]);
  function toggle(file: string) { setSelected((current) => current.includes(file) ? current.filter((value) => value !== file) : [...current, file]); setPreview(null); }
  async function loadSuggestions() {
    if (requestInFlight.current) return; requestInFlight.current = true;
    setBusy(true); setError("");
    try { const response = await fetch("/api/chatgpt-packages/suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acquisitionId, limit: 12 }) }); const payload = await response.json() as { suggestions?: Suggestion[]; availableFiles?: string[]; error?: string }; if (!response.ok) throw new Error(payload.error); setSuggestions(payload.suggestions ?? []); setAvailable(payload.availableFiles ?? []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Suggestions impossibles."); } finally { requestInFlight.current = false; setBusy(false); }
  }
  async function previewPackage() {
    if (requestInFlight.current) return; requestInFlight.current = true;
    setBusy(true); setError("");
    try { const response = await fetch("/api/chatgpt-packages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preview", acquisitionId, selectedFiles: selected, suggestedFilesRejected: rejected, allowStructuralUpdate: structural }) }); const payload = await response.json() as { preview?: PackagePreviewRecord; error?: string }; if (!response.ok || !payload.preview) throw new Error(payload.error); setPreview(payload.preview); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Prévisualisation impossible."); } finally { requestInFlight.current = false; setBusy(false); }
  }
  async function generate() {
    if (requestInFlight.current) return; requestInFlight.current = true; setBusy(true); setError("");
    try { const response = await fetch("/api/chatgpt-packages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "generate", acquisitionId, selectedFiles: selected, suggestedFilesRejected: rejected, allowStructuralUpdate: structural, expectedSnapshot: preview?.snapshot }) }); const payload = await response.json() as { package?: StoredChatGptPackage; error?: string }; if (!response.ok || !payload.package) throw new Error(payload.error); if (workflowId) { const linked = await fetch(`/api/workflows/${workflowId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "attach-package", packageId: payload.package.manifest.packageId }) }); if (!linked.ok) throw new Error("Le paquet a été créé, mais son rattachement au traitement a échoué."); } router.push(`/chatgpt-packages/${payload.package.manifest.packageId}`); router.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Génération impossible."); } finally { requestInFlight.current = false; setBusy(false); }
  }
  return <div className="space-y-6">
    <ol className="grid gap-2 text-sm sm:grid-cols-3">{["1. Source", "2. Documents utiles", "3. Créer le paquet"].map((label) => <li key={label} className="rounded-lg bg-slate-100 p-3 font-semibold dark:bg-slate-900">{label}</li>)}</ol>
    <section className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800"><h2 className="text-xl font-bold">1. Choisir la transcription</h2><p className="mt-2 text-sm text-slate-500">La transcription provenant du traitement est présélectionnée.</p><select value={acquisitionId} onChange={(event) => { setAcquisitionId(event.target.value); setSuggestions([]); setAvailable([]); setSelected([]); setRejected([]); setPreview(null); }} className="mt-4 w-full rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">{acquisitions.map((job) => <option key={job.id} value={job.id}>{job.title ?? "Transcription sans titre"}</option>)}</select></section>
    <section className="rounded-2xl border border-slate-200 p-5 dark:border-slate-800"><h2 className="text-xl font-bold">2. Documents utiles</h2><p className="mt-2 text-sm text-slate-500">Les règles, la taxonomie, l’index et les sources obligatoires sont toujours inclus. Chargez des suggestions lexicales pour compléter ce contexte.</p><button type="button" disabled={!acquisitionId || busy} onClick={loadSuggestions} className="mt-3 rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950">Charger le contexte recommandé</button><div className="mt-4 grid gap-3">{suggestions.map((item) => <label key={item.relativePath} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><input type="checkbox" checked={selected.includes(item.relativePath)} onChange={() => { toggle(item.relativePath); setRejected((current) => current.filter((value) => value !== item.relativePath)); }} /> <strong>{item.title}</strong><span className="block text-xs text-slate-500">{item.reason}</span></label>)}</div><p className="mt-3 text-xs text-slate-500">{selected.length} document(s) supplémentaire(s) sélectionné(s).</p><details className="mt-5 rounded-xl border border-slate-200 p-4 dark:border-slate-700"><summary className="cursor-pointer font-semibold">Réglages avancés</summary><input value={manualSearch} onChange={(event) => setManualSearch(event.target.value)} placeholder="Rechercher manuellement un fichier ou dossier" className="mt-4 w-full rounded-lg border border-slate-300 p-3 dark:border-slate-700 dark:bg-slate-900" /><div className="mt-3 max-h-64 overflow-auto">{visibleFiles.map((file) => <label key={file} className="block py-1 text-sm"><input type="checkbox" checked={selected.includes(file)} onChange={() => toggle(file)} /> {file}</label>)}</div>{manualSearch.endsWith("/") ? <button type="button" onClick={() => setSelected((current) => [...new Set([...current, ...available.filter((file) => file.startsWith(manualSearch))])])} className="mt-2 rounded-lg border border-violet-400 px-3 py-2 text-sm">Sélectionner ce dossier</button> : null}<label className="mt-5 flex gap-3"><input type="checkbox" checked={structural} onChange={(event) => { setStructural(event.target.checked); setPreview(null); }} /> Autoriser aussi les changements de structure générale.</label><p className="mt-3 text-xs text-slate-500">Les créations restent limitées à la bibliothèque et les remplacements aux documents sélectionnés. Les changements structurels exigent une confirmation renforcée.</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" disabled={busy || !acquisitionId} onClick={previewPackage} className="rounded-lg border border-violet-400 px-4 py-2 font-semibold">Prévisualiser la composition</button><button type="button" onClick={() => { setSelected([]); setRejected([]); setPreview(null); }} className="text-sm text-rose-700">Réinitialiser</button></div>{preview ? <div className="mt-5 space-y-3"><p>{preview.estimates.words} mots, {preview.estimates.contexts} documents et {preview.estimates.segments} segment(s).</p><details><summary className="font-semibold">Détails techniques du paquet</summary><div className="mt-3 space-y-4"><pre className="max-h-80 overflow-auto text-xs">{preview.tree.join("\n")}</pre><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{preview.request}</pre><pre className="max-h-80 overflow-auto text-xs">{JSON.stringify(preview.manifest, null, 2)}</pre></div></details></div> : null}</details></section>
    <section className="rounded-2xl border border-violet-300 bg-violet-50 p-5 dark:border-violet-900 dark:bg-violet-950/20"><h2 className="text-xl font-bold">3. Créer le paquet à analyser</h2><p className="mt-2 text-sm">Cette action crée un seul ZIP de demande. Aucun appel payant et aucune écriture dans la bibliothèque.</p><button type="button" disabled={busy || !acquisitionId} onClick={generate} className="mt-4 rounded-lg bg-violet-600 px-5 py-3 font-bold text-white disabled:opacity-40">{busy ? "Création…" : "Créer le paquet à analyser"}</button></section>
    {error ? <p role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">{error}</p> : null}
  </div>;
}

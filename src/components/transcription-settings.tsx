"use client";

import { useEffect, useState } from "react";

import type { DiagnosticItem } from "@/lib/transcription/health";

export function TranscriptionSettings() {
  const [items, setItems] = useState<DiagnosticItem[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { void fetch("/api/transcription/health", { cache: "no-store" }).then((response) => response.json()).then((payload: { items?: DiagnosticItem[] }) => setItems(payload.items || [])).finally(() => setLoading(false)); }, []);
  if (loading) return <p>Diagnostic en cours…</p>;
  return <div className="space-y-5"><div className="space-y-2">{items.map((item) => <article key={item.name} className="flex flex-wrap justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div><strong>{item.name}</strong><p className="mt-1 text-sm text-slate-500">{item.detail}</p></div><span className={`h-fit rounded-full px-3 py-1 text-xs font-bold ${item.status === "OK" ? "bg-emerald-100 text-emerald-800" : item.status === "OPTIONNEL" ? "bg-slate-100 text-slate-700" : "bg-amber-100 text-amber-900"}`}>{item.status}</span></article>)}</div><div className="rounded-xl bg-slate-100 p-4 text-sm dark:bg-slate-900"><p><strong>Valeurs CPU par défaut :</strong> small · cpu · int8 · concurrence 1.</p><p className="mt-2">Exécutez <code>scripts/setup-transcription.ps1</code> puis <code>scripts/check-transcription-tools.ps1</code> dans PowerShell. FFmpeg reste une installation manuelle.</p></div></div>;
}


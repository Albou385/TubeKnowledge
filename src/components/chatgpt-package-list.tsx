"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { StoredChatGptPackage } from "@/lib/chatgpt-packages/runtime";

export function ChatGptPackageList({ initialPackages }: { initialPackages: StoredChatGptPackage[] }) {
  const [packages, setPackages] = useState(initialPackages);
  const [filter, setFilter] = useState("all");
  const shown = useMemo(() => packages.filter((item) => filter === "all" || (filter === "ready" ? ["ready", "downloaded"].includes(item.status.status) : filter === "result-received" ? ["result-received", "result-previewed", "rejected"].includes(item.status.status) : item.status.status === filter)), [filter, packages]);
  async function remove(id: string) {
    if (!window.confirm("Supprimer explicitement ce Paquet ChatGPT et son résultat local ?")) return;
    const response = await fetch(`/api/chatgpt-packages/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
    if (response.ok) setPackages((current) => current.filter((item) => item.manifest.packageId !== id));
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap gap-2">{[["all", "Tous"], ["ready", "Prêts"], ["result-received", "Résultat reçu"], ["imported", "Importés"]].map(([value, label]) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-full px-4 py-2 text-sm ${filter === value ? "bg-violet-500 text-white" : "border border-slate-300 dark:border-slate-700"}`}>{label}</button>)}</div>
    {shown.length ? <div className="grid gap-4">{shown.map((item) => <article key={item.manifest.packageId} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold text-violet-600 uppercase">{item.status.status === "imported" ? "Ajouté" : item.status.status === "rejected" ? "Résultat à remplacer" : item.status.status.startsWith("result-") ? "Résultat reçu" : "Prêt à analyser"}</p><h2 className="mt-1 text-xl font-bold">{item.manifest.source.title}</h2><p className="mt-2 text-sm text-slate-500">Créé le {new Date(item.status.createdAt).toLocaleString("fr-CA")} · {item.status.zipBytes.toLocaleString("fr-CA")} octets</p></div><div className="flex gap-2"><Link href={`/chatgpt-packages/${item.manifest.packageId}`} className="rounded-lg bg-violet-500 px-4 py-2 font-semibold text-white">Continuer</Link><details className="relative"><summary className="cursor-pointer rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700">Plus</summary><button type="button" onClick={() => remove(item.manifest.packageId)} className="mt-2 rounded-lg border border-rose-400 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">Supprimer</button></details></div></div></article>)}</div> : <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-500 dark:border-slate-700">Aucun paquet dans ce filtre.</p>}
  </div>;
}

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SHORT_CHATGPT_INSTRUCTION } from "@/lib/chatgpt-packages/constants";

export function ChatGptPackageActions({ packageId }: { packageId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  async function download() {
    await fetch(`/api/chatgpt-packages/${packageId}/downloaded`, { method: "POST" });
    window.location.assign(`/api/chatgpt-packages/${packageId}/download`);
  }
  async function copy() {
    await navigator.clipboard.writeText(SHORT_CHATGPT_INSTRUCTION);
    setMessage("Instruction courte copiée.");
  }
  async function remove() {
    if (!window.confirm("Supprimer explicitement ce paquet et son résultat local ?")) return;
    const response = await fetch(`/api/chatgpt-packages/${packageId}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
    if (response.ok) { router.push("/chatgpt-packages"); router.refresh(); }
  }
  return <div className="space-y-4"><div className="grid gap-3 md:grid-cols-3"><button type="button" onClick={download} className="rounded-xl bg-violet-500 px-4 py-3 font-bold text-white">1. Télécharger le paquet</button><button type="button" onClick={copy} className="rounded-xl border border-violet-400 px-4 py-3 font-semibold">2. Copier l’instruction</button><a href={`/chatgpt-packages/${packageId}/result`} className="rounded-xl bg-amber-500 px-4 py-3 text-center font-bold text-slate-950">3. Importer le ZIP retourné</a></div>{message ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p> : null}<details className="text-sm text-slate-500"><summary className="cursor-pointer font-semibold">Actions avancées</summary><button type="button" onClick={remove} className="mt-3 rounded-xl border border-rose-400 px-4 py-2 text-rose-700 dark:text-rose-300">Supprimer ce paquet local</button></details></div>;
}

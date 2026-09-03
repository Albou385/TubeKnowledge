import Link from "next/link";

import { ChatGptPackageList } from "@/components/chatgpt-package-list";
import { ConfigurationHelp } from "@/components/configuration-help";
import { LibraryShell } from "@/components/library-shell";
import { listStoredPackages } from "@/lib/chatgpt-packages/runtime";
import { inspectLibrary } from "@/lib/library/library-reader";

export const dynamic = "force-dynamic";

export default async function ChatGptPackagesPage() {
  const [library, packages] = await Promise.all([inspectLibrary(), listStoredPackages()]);
  if (!library.available) return <ConfigurationHelp message={library.message} />;
  return <LibraryShell tree={library.tree}><main className="mx-auto max-w-5xl"><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold tracking-[0.16em] text-violet-600 uppercase">Analyse manuelle</p><h1 className="mt-2 text-3xl font-bold">Paquets d’analyse</h1><p className="mt-3 text-slate-600 dark:text-slate-400">Préparez le contexte, envoyez le paquet à ChatGPT, puis importez séparément le ZIP retourné.</p></div><Link href="/chatgpt-packages/new" className="rounded-xl bg-violet-500 px-5 py-3 font-bold text-white">Préparer une analyse</Link></div><div className="mt-8"><ChatGptPackageList initialPackages={packages} /></div></main></LibraryShell>;
}

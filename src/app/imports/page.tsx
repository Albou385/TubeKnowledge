import { ConfigurationHelp } from "@/components/configuration-help";
import { ImportWorkbench } from "@/components/import-workbench";
import { LibraryShell } from "@/components/library-shell";
import { inspectLibrary } from "@/lib/library/library-reader";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const library = await inspectLibrary();
  if (!library.available) return <ConfigurationHelp message={library.message} />;
  return <LibraryShell tree={library.tree}><div className="mx-auto max-w-5xl"><p className="text-xs font-semibold tracking-[0.16em] text-amber-600 uppercase">Vérification humaine</p><h1 className="mt-2 text-3xl font-bold">Vérifier les changements</h1><p className="mt-3 mb-8 text-slate-600 dark:text-slate-400">Examinez le contenu proposé avant toute écriture. Rien n’est ajouté automatiquement.</p><ImportWorkbench /></div></LibraryShell>;
}

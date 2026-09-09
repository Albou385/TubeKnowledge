import { ConfigurationHelp } from "@/components/configuration-help";
import { LibraryNavigationOverview } from "@/components/library-navigation-overview";
import { LibraryShell } from "@/components/library-shell";
import { getLibraryNavigation } from "@/lib/library/library-navigation";
import { inspectLibrary } from "@/lib/library/library-reader";

export const dynamic = "force-dynamic";

export default async function LibraryIndexPage() {
  const library = await inspectLibrary();
  if (!library.available) return <ConfigurationHelp message={library.message} />;
  const domains = await getLibraryNavigation(library.tree);
  return <LibraryShell tree={library.tree}>
    <div className="mx-auto max-w-6xl">
      <p className="text-xs font-semibold tracking-[0.16em] text-cyan-700 uppercase dark:text-cyan-300">Bibliothèque</p>
      <h1 className="mt-2 text-3xl font-bold">Domaines, sujets et notions</h1>
      <p className="mt-3 max-w-3xl text-slate-600 dark:text-slate-400">Navigation de lecture calculée à partir des fichiers Markdown présents. Les résumés, sources et relations ne sont affichés que lorsqu’ils sont explicitement lisibles dans les notes.</p>
      <LibraryNavigationOverview domains={domains} />
    </div>
  </LibraryShell>;
}

import { ConfigurationHelp } from "@/components/configuration-help";
import { LibraryNavigationOverview } from "@/components/library-navigation-overview";
import { LibraryShell } from "@/components/library-shell";
import { SearchBox } from "@/components/search-box";
import { getLibraryNavigation } from "@/lib/library/library-navigation";
import { inspectLibrary } from "@/lib/library/library-reader";

export const dynamic = "force-dynamic";

export default async function LibraryIndexPage() {
  const library = await inspectLibrary();
  if (!library.available) return <ConfigurationHelp message={library.message} />;
  const domains = await getLibraryNavigation(library.tree);
  return <LibraryShell tree={library.tree}>
    <div className="mx-auto max-w-6xl">
      <h1 className="text-3xl font-bold">Bibliothèque</h1>
      <p className="mt-3 max-w-3xl text-slate-600 dark:text-slate-400">Retrouvez vos connaissances par domaine, puis par sujet et notion.</p>
      <div className="mt-6 max-w-xl"><SearchBox /></div>
      <LibraryNavigationOverview domains={domains} />
    </div>
  </LibraryShell>;
}

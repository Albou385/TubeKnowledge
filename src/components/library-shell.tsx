import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import type { LibraryNode } from "@/lib/library/types";

export function LibraryShell({ children }: { tree?: LibraryNode[]; currentPath?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <AppHeader />
      <main className="mx-auto min-w-0 max-w-6xl p-4 sm:p-8 lg:p-10">{children}</main>
    </div>
  );
}

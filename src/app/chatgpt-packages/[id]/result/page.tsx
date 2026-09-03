import Link from "next/link";

import { ChatGptResultWorkbench } from "@/components/chatgpt-result-workbench";
import { LibraryShell } from "@/components/library-shell";
import { loadStoredPackage } from "@/lib/chatgpt-packages/runtime";
import { inspectLibrary } from "@/lib/library/library-reader";
import { resumeImportPreview } from "@/lib/imports/preview";
import { ImportSessionError, publicImportSessionError } from "@/lib/imports/sessions";
import { findWorkflowByPackageId } from "@/lib/workflows/orchestrator";

export const dynamic = "force-dynamic";

export default async function ChatGptResultPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const [library, stored, workflow] = await Promise.all([inspectLibrary(), loadStoredPackage(id), findWorkflowByPackageId(id)]);
  if (!library.available) throw new Error(library.message);
  let resumedPreview = null;
  let sessionIssue: { code: string; message: string; action: string } | null = null;
  if (workflow?.previewSessionId) {
    try { resumedPreview = await resumeImportPreview(workflow.previewSessionId); }
    catch (error) {
      sessionIssue = error instanceof ImportSessionError
        ? publicImportSessionError(error)
        : { code: "SESSION_INVALID", message: "Cette vérification locale est invalide.", action: "Prévalidez de nouveau le ZIP retourné." };
    }
  }
  return <LibraryShell tree={library.tree}><main className="mx-auto max-w-5xl"><Link href={`/chatgpt-packages/${id}`} className="text-sm text-violet-700 dark:text-violet-300">← Revoir les trois étapes</Link><p className="mt-6 text-xs font-semibold tracking-[0.16em] text-violet-600 uppercase">Étape 3 sur 3</p><h1 className="mt-2 text-3xl font-bold">Importer le ZIP retourné</h1><p className="mt-3 mb-8 text-slate-600 dark:text-slate-400">Résultat attendu pour « {stored.manifest.source.title} ». Aucun changement n’est écrit avant votre vérification et votre confirmation.</p><ChatGptResultWorkbench packageId={id} workflowId={workflow?.workflowId} initialPreview={resumedPreview} initialSessionIssue={sessionIssue} /></main></LibraryShell>;
}

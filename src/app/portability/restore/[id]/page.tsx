import { AppHeader } from "@/components/app-header";
import { RestoreForm } from "@/components/portability-actions";
export default async function RestorePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <><AppHeader /><main className="mx-auto max-w-3xl space-y-6 px-4 py-8"><h1 className="text-3xl font-bold">Restauration contrôlée</h1><p className="rounded-xl border border-amber-300 p-4">Le mode staging est recommandé. Le mode in-place exige writer, stabilité, absence de conflit, backup pré-restauration et la phrase exacte RESTAURER.</p><RestoreForm backupId={id} /></main></>; }


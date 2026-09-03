import { AppHeader } from "@/components/app-header";
import { HandoffForm } from "@/components/portability-actions";
export default function HandoffPage() { return <><AppHeader /><main className="mx-auto max-w-2xl space-y-6 px-4 py-8"><h1 className="text-3xl font-bold">Transfert du rôle writer</h1><ol className="list-decimal space-y-2 pl-5"><li>Créer et vérifier un backup global hors OneDrive.</li><li>Créer un checkpoint stable.</li><li>Préparer le handoff et libérer writer.</li><li>Attendre manuellement la fin visible de OneDrive.</li><li>Sur l’autre machine, comparer le checkpoint et accepter.</li></ol><HandoffForm /><p className="text-sm text-slate-500">L’absence de changement local ne prouve jamais que le cloud est synchronisé.</p></main></>; }


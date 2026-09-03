import { AppHeader } from "@/components/app-header";

export function ConfigurationHelp({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-6 sm:p-8 dark:border-amber-900/70 dark:bg-amber-950/20">
          <p className="mb-3 text-sm font-semibold tracking-wider text-amber-700 uppercase dark:text-amber-300">
            Configuration requise
          </p>
          <h1 className="text-2xl font-bold text-slate-950 dark:text-white">Bibliothèque indisponible</h1>
          <p className="mt-3 text-slate-700 dark:text-slate-300">{message}</p>
          <ol className="mt-6 space-y-3 text-sm text-slate-700 dark:text-slate-300">
            <li><strong>1.</strong> Copiez <code>.env.example</code> vers <code>.env.local</code>.</li>
            <li><strong>2.</strong> Définissez <code>YOUTUBE_LIBRARY_PATH</code> avec le chemin absolu de votre coffre.</li>
            <li><strong>3.</strong> Redémarrez <code>npm run dev</code>.</li>
          </ol>
          <p className="mt-6 rounded-xl bg-slate-900 p-4 text-sm text-slate-400">
            Le chemin local complet reste côté serveur et n’est pas affiché dans cette page.
          </p>
        </div>
      </main>
    </div>
  );
}

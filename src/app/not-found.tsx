import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="text-center">
        <p className="text-sm font-semibold text-cyan-300">404</p>
        <h1 className="mt-2 text-3xl font-bold">Page introuvable</h1>
        <Link href="/" className="mt-6 inline-block text-cyan-300 hover:text-cyan-200">Retour à l’accueil</Link>
      </div>
    </main>
  );
}

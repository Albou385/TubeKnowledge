"use client";

export function ThemeToggle() {
  function toggleTheme() {
    const root = document.documentElement;
    const nextTheme = root.classList.contains("dark") ? "light" : "dark";
    root.classList.toggle("dark", nextTheme === "dark");
    root.classList.toggle("light", nextTheme === "light");
    window.localStorage.setItem("tubeknowledge-theme", nextTheme);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Basculer entre le thème clair et le thème sombre"
      title="Changer de thème"
      className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-300 bg-white text-lg text-slate-700 hover:border-cyan-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
    >
      <span aria-hidden="true">◐</span>
    </button>
  );
}

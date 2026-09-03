import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TubeKnowledge",
    template: "%s · TubeKnowledge",
  },
  description: "Consultation locale et sécurisée d’une bibliothèque Markdown.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var saved=localStorage.getItem('tubeknowledge-theme');var theme=saved||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark');document.documentElement.classList.add(theme)}catch(e){document.documentElement.classList.add('dark')}})();` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

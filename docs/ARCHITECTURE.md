# Architecture

TubeKnowledge est une application Next.js App Router en TypeScript strict, avec Tailwind CSS, Zod et Vitest. L’interface est servie localement ; les accès au système de fichiers se font exclusivement côté serveur.

Le vault Markdown externe est la seule source de vérité. Les sessions, files, runtimes et sauvegardes sont séparés du vault. Les entrées utilisateur et les archives d’import sont validées et bornées avant traitement. Aucun chemin relatif ne peut sortir du vault configuré et les liens symboliques externes ne sont pas suivis silencieusement.

Toutes les écritures métier passent par une autorité d’écriture unique et par le pipeline Preview/Apply : validation, confirmation, sauvegarde, verrou, écriture atomique et vérification d’empreinte. Les lectures et diagnostics ne déclenchent pas d’écriture métier.

Les fournisseurs d’analyse sont isolés. Le parcours manuel reste disponible et un fournisseur externe doit être activé explicitement avec une configuration locale ; aucune configuration sensible ne doit être exposée au navigateur.

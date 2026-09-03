# Contribuer

## Préparer l’environnement

Sous PowerShell Windows, à la racine du dépôt :

```powershell
npm.cmd ci
Copy-Item .env.example .env.local
```

Configurez uniquement des chemins locaux fictifs ou privés dans `.env.local`.
Ne commitez jamais ce fichier, une clé, un vault ou un transcript.

## Travail et validations

Créez une branche `feature/<sujet>` depuis la base demandée. Gardez les
changements ciblés et préservez les fichiers de travail existants. Avant une
proposition, exécutez au minimum :

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
git diff --check
```

Les tests potentiellement destructifs utilisent `%TEMP%` ou une fixture. Les
écritures du vault passent toujours par Preview, confirmation, backup et
Apply. Toute modification de sécurité ou d’écriture doit préciser sa portée
et ses preuves.

## Commits

Utilisez des messages en français au format `type(scope): résumé impératif`,
par exemple `fix(import): refuser une cible hors vault`. Inspectez les fichiers
suivis et non suivis avant commit; n’incluez aucun secret ni artefact local.
Les commits, push et changements de visibilité restent soumis au mandat
explicite du mainteneur.

# TubeKnowledge

TubeKnowledge est une application Windows locale et mono-utilisateur qui aide à transformer des vidéos en connaissances Markdown vérifiables. Votre vault Markdown demeure la source de vérité : l’application le consulte localement et toute écriture passe par une prévisualisation, une confirmation, une sauvegarde et une application contrôlée.

## Fonctionnalités

- parcourir et rechercher une bibliothèque Markdown locale ;
- inspecter des vidéos publiques et choisir une piste de transcription ;
- importer du texte ou utiliser une transcription locale optionnelle ;
- préparer des changements, en examiner les différences, puis les appliquer ;
- gérer une file locale séquentielle pour plusieurs vidéos ;
- interroger la bibliothèque avec des citations vérifiables ;
- diagnostiquer la configuration locale sans transmettre le vault au navigateur.

## Prérequis

- Windows 10 ou 11 ;
- Node.js 20.9 ou plus récent ;
- npm ;
- un vault Markdown contenant `INDEX.md` à sa racine.

## Installation et démarrage

Dans PowerShell, à la racine du projet :

```powershell
cd C:\Users\YourName\source\TubeKnowledge
npm.cmd ci
Copy-Item .env.example .env.local
```

Renseignez ensuite un chemin absolu dans `.env.local` :

```env
YOUTUBE_LIBRARY_PATH=C:\Users\YourName\Documents\MyMarkdownVault
```

Ne versionnez jamais `.env.local`. Le chemin est lu uniquement par le serveur local et ne doit pas sortir du vault configuré.

Lancez l’application :

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-tubeknowledge.ps1 -OpenBrowser
```

Le serveur utilise le port `3100` par défaut. `npm.cmd run dev` reste également disponible. Les scripts PowerShell sont destinés à PowerShell sous Windows ; `npm.cmd` évite les restrictions qui peuvent viser `npm.ps1`.

## Utilisation

1. Ouvrez l’application locale et vérifiez la page **Diagnostic**.
2. Ajoutez une vidéo, choisissez explicitement sa source de transcription et vérifiez le transcript obtenu.
3. Préparez l’analyse ou l’import souhaité.
4. Lisez la Preview et les différences proposées.
5. Confirmez l’opération pour créer la sauvegarde et appliquer les changements.

Les traitements automatiques ne choisissent pas une transcription, un modèle ou une modification du vault à votre place. Une file peut automatiser l’inspection, mais pas la décision éditoriale ni l’écriture.

## Limites et sécurité

- Le projet est conçu pour une utilisation locale sur une seule machine.
- Les accès au système de fichiers restent côté serveur ; les chemins sont normalisés et bornés au vault.
- Les connaissances ne sont pas dupliquées dans une base de données.
- Les opérations d’écriture utilisent Preview/Apply, confirmation, verrou, écriture atomique et vérification d’intégrité.
- Les fournisseurs externes ou payants restent optionnels et nécessitent une configuration locale explicite.
- La disponibilité d’un outil de transcription ne garantit pas l’accès réseau à une plateforme vidéo.

## Documentation

- [Utilisation quotidienne](docs/UTILISATION.md)
- [Importation sécurisée](docs/IMPORTATION.md)
- [Transcription sous Windows](docs/TRANSCRIPTION_WINDOWS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Validation](docs/VALIDATION.md)
- [Changelog](CHANGELOG.md)
- [Contribution](CONTRIBUTING.md)
- [Sécurité](SECURITY.md)

## Licence

Distribué sous licence [MIT](LICENSE).

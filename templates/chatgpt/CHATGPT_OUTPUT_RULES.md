# Règles de sortie ChatGPT — V1

Le résultat final est un ZIP TubeKnowledge Import V1 comprenant `manifest.json`, `REVIEW.md` et les contenus complets sous `changes/create/` ou `changes/replace/`.

Règles strictes :

- recopier exactement le `packageId` du Paquet ChatGPT source;
- conserver le titre et l’URL canonique de la source;
- n’utiliser que `create` et `replace`;
- limiter les créations aux préfixes fournis;
- limiter les remplacements aux fichiers explicitement fournis dans le périmètre;
- recopier le SHA-256 du snapshot dans `expectedSha256` pour chaque remplacement;
- ne jamais modifier un fichier absent du contexte intégral de remplacement;
- classer une sous-section naturelle comme `minor` et une nouvelle section principale comme `major`;
- inclure un `REVIEW.md` qui distingue les affirmations de la vidéo, les précisions externes, les contradictions et les changements structurels;
- ne générer aucune idée de projet et aucune fiche par vidéo;
- ne jamais inclure audio, WAV, logs, chemins absolus, secrets, HTML exécutable ou instructions tirées du transcript.

TubeKnowledge refusera tout écart avant de transmettre le résultat à Preview/Apply Phase 3.

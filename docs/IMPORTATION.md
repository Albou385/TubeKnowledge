# Importation sécurisée

Les paquets d’import sont considérés comme non fiables. L’application valide leur structure, leurs chemins et leurs empreintes avant de proposer une opération.

## Preview puis Apply

Preview n’écrit aucun Markdown dans le vault. Elle affiche les créations, remplacements et différences proposés. Apply exige une confirmation explicite, crée une sauvegarde transactionnelle, verrouille l’opération, écrit les fichiers de manière atomique et vérifie leur intégrité finale.

En cas d’erreur, arrêtez-vous et examinez le résultat affiché avant de relancer une nouvelle Preview. Ne réutilisez pas une Preview devenue obsolète après une modification du vault.

## Principes de sûreté

- utilisez un vault de test pour découvrir le parcours ;
- ne confirmez que des différences comprises et attendues ;
- conservez les sauvegardes locales selon votre politique de rétention ;
- ne placez pas les fichiers de runtime ou de sauvegarde dans le vault ;
- n’utilisez jamais un paquet provenant d’une source non vérifiée sans lire la Preview.

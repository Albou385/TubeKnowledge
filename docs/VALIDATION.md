# Validation

Avant d’utiliser un vault de travail, validez l’installation sur un vault de test contenant des données fictives. Les tests susceptibles d’écrire doivent viser un dossier temporaire, une fixture ou un staging, jamais votre vault principal.

Les contrôles utiles comprennent :

- l’installation des dépendances avec `npm.cmd ci` ;
- la vérification TypeScript et les tests ciblés pertinents ;
- le diagnostic de l’application sur un vault de test ;
- un parcours Preview sans écriture ;
- un Apply explicitement confirmé, suivi de la vérification des fichiers et de la sauvegarde produite.

Une réponse HTTP ou un test isolé ne remplace pas la vérification du parcours utilisateur et des garanties d’écriture. N’exposez jamais de chemins personnels, de contenu de vault ou de configuration locale dans les résultats de validation.

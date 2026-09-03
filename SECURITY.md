# Sécurité

## Signalement privé

Pour signaler une vulnérabilité, utilisez **Security → Report a vulnerability**
sur GitHub lorsque le signalement privé est activé; sinon, contactez le
propriétaire du dépôt par un canal privé. Ne publiez pas de détail exploitable dans une issue
publique; indiquez une description, l’impact, les étapes minimales de
reproduction et une proposition de contact sécurisé.

Ne joignez jamais de secret, clé API, mot de passe, fichier `.env`, vault,
transcript, backup, archive runtime ou chemin personnel. Remplacez les
valeurs sensibles par des fixtures minimales et anonymisées.

## Portée supportée

TubeKnowledge est une application locale Windows mono-utilisateur. Les accès
au système de fichiers sont côté serveur, le vault Markdown est la source de
vérité et Preview/confirmation/backup/Apply forment l’unique frontière
d’écriture. OneDrive n’est ni un verrou distribué ni une preuve de
synchronisation. Le provider OpenAI payant est facultatif et non qualifié pour
la production.

Les tests destructifs doivent cibler `%TEMP%` ou un staging explicite, jamais
le vault réel. Les chemins et secrets restent dans `.env.local`, non suivi.

## Limites

Les protections visent une utilisation locale coopérative; elles ne
constituent pas une sandbox contre un autre processus du même compte capable
de modifier activement le système de fichiers.

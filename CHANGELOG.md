# Changelog

Toutes les modifications notables de TubeKnowledge sont consignées dans ce
fichier.

## [1.1.0] — 2026-09-09

### Ajouté

- navigation de bibliothèque par domaines, sujets et notions;
- parcours de qualification déterministe et benchmark de récupération synthétique.

### Corrigé

- remplace les erreurs techniques de prévisualisation d’import par une action utilisateur claire.

## [1.0.2] — 2026-09-03

### Corrigé

- réconcilie une baseline locale périmée lorsque le vault courant correspond
  déjà au checkpoint vérifié, sans modifier les connaissances Markdown ni
  créer un nouveau checkpoint.

## [1.0.1] — 2026-09-03

### Corrigé

- débloque la conservation explicite d’une divergence de contenu locale quand
  le writer de la même machine a expiré, avec backup vérifié, confirmation
  renforcée et réacquisition atomique de l’autorité locale.

## [1.0.0] — 2026-09-03

### Ajouté

- première distribution publique de TubeKnowledge sous licence MIT;
- application locale Windows pour consulter une bibliothèque Markdown,
  préparer des transcriptions et appliquer des changements confirmés.

### Sécurité

- les connaissances restent dans le vault Markdown local;
- toute écriture passe par Preview/Apply, confirmation, sauvegarde et
  vérification d’intégrité.


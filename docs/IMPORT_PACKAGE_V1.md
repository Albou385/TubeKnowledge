# Paquet d’importation TubeKnowledge V1

## Structure

Le ZIP contient directement `manifest.json`, `REVIEW.md` et `changes/create/...` ou `changes/replace/...`. Une racine unique facultative `tubeknowledge-import/` peut envelopper cette structure.

Le manifeste suit exactement le schéma décrit dans la spécification Phase 3 : `schemaVersion: 1`, UUID, date ISO, source, résumé, changement structurel et 1 à 50 opérations `create`/`replace`.

`contentFile` doit être exactement `changes/<type>/<path>`. Tous les hashes sont des SHA-256 hexadécimaux de 64 caractères calculés sur les octets UTF-8 du contenu complet.

## Cibles

- `INDEX.md`;
- `00_SYSTEME/TAXONOMY.md`;
- `00_SYSTEME/CHANGELOG.md`;
- `01_BIBLIOTHEQUE/**/*.md`;
- `02_SOURCES/videos.md`.

Tout autre chemin est refusé. `create` exige `expectedState: "absent"`; `replace` exige `expectedSha256`.

## Limites

10 MiB compressés, 100 entrées, 10 MiB décompressés, 1 MiB par Markdown et 50 opérations. UTF-8 valide uniquement. Aucun ZIP imbriqué, chiffrement, symlink, fichier inattendu ou racine ambiguë.

## Exemple minimal

```json
{
  "schemaVersion": 1,
  "packageId": "123e4567-e89b-42d3-a456-426614174000",
  "generatedAt": "2026-07-21T22:00:00.000Z",
  "source": { "type": "manual-notes", "title": "Notes", "url": "https://example.test/source" },
  "summary": "Ajout d’une notion.",
  "structuralChange": { "level": "none", "confirmationRequired": false, "summary": "Aucune restructuration." },
  "operations": [{
    "type": "create",
    "path": "01_BIBLIOTHEQUE/Test/notion.md",
    "contentFile": "changes/create/01_BIBLIOTHEQUE/Test/notion.md",
    "expectedState": "absent",
    "newSha256": "SHA256_HEX_64_CARACTERES"
  }]
}
```

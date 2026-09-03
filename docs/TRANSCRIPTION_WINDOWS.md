# Transcription sous Windows

La transcription locale est optionnelle. Elle nécessite Python 3.12 64 bits, FFmpeg et ffprobe accessibles par le `PATH` ou configurés localement.

Dans PowerShell, à la racine du projet, préparez l’environnement :

```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-transcription.ps1
powershell -ExecutionPolicy Bypass -File scripts/check-transcription-tools.ps1
```

Si Python 3.12 est absent, installez une distribution maintenue puis relancez le setup. Le script crée un environnement virtuel local, vérifie l’interpréteur actif et installe les dépendances du worker. Il ne modifie pas `.env.local`, ne télécharge pas de modèle et ne contourne pas la validation TLS.

Installez FFmpeg depuis une source de confiance, puis vérifiez :

```powershell
ffmpeg -version
ffprobe -version
```

Conservez le runtime, les modèles et les caches hors du dépôt et hors du vault, par exemple sous `C:\Users\YourName\AppData\Local\TubeKnowledge`. Le premier chargement d’un modèle demande une confirmation explicite.

En cas d’échec, utilisez le diagnostic pour distinguer le launcher Python, l’interpréteur actif, l’environnement virtuel, le worker et FFmpeg. Un outil disponible ne prouve pas qu’une récupération réseau réussira.

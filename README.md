## Péribus - Console Temps Réel

Ce dépôt contient la console web temps réel du réseau Péribus (Grand Périgueux). L'application charge les données GTFS en local, applique un routage hybride et affiche les bus en direct sur une carte Leaflet.

### Prétraitement des données GTFS

Le chargement du navigateur repose désormais sur un bundle optimisé (`public/data/gtfs/gtfs.bundle.json`). Il doit être régénéré à chaque mise à jour des fichiers `*.txt` fournis par l'AO.

#### Option 1 – Node.js (script dédié)

```
node scripts/preprocess-gtfs.mjs
```

Le script lit les fichiers CSV présents dans `public/data/gtfs`, nettoie les valeurs puis écrit `gtfs.bundle.json`.

#### Option 2 – PowerShell natif (pas de dépendance)

```
$base = "c:/Users/<vous>/Peribus Test design/public/data"
$gtfs = Join-Path $base 'gtfs'
$files = 'routes','trips','stop_times','stops','calendar','calendar_dates'
$bundle = [ordered]@{}
foreach ($name in $files) {
	$bundle[$name -replace 'calendar_dates','calendarDates' -replace 'stop_times','stopTimes'] = Import-Csv (Join-Path $gtfs ("$name.txt"))
}
$bundle['geoJson'] = (Get-Content (Join-Path $base 'map.geojson') -Raw | ConvertFrom-Json)
$bundle | ConvertTo-Json -Depth 12 | Set-Content (Join-Path $gtfs 'gtfs.bundle.json') -Encoding UTF8
```

### Chargement côté client

- `public/js/workers/gtfsWorker.js` charge le bundle (ou relit les CSV en fallback) dans un Web Worker, construit les index GTFS puis transfère le résultat au `DataManager`.
- `public/js/utils/gtfsProcessor.js` centralise le nettoyage et la génération des index (`routesById`, `stopsByName`, `stopTimesByTrip`, etc.).

### Lancer l'application

Ouvrir `public/index.html` avec un serveur statique (Live Server VS Code par exemple). La console affichera la progression du chargement GTFS et la carte deviendra interactive une fois les données prêtes.

### Étapes suivantes

- Refactoring complet de `main.js` (UIManager, Router, Geolocation Manager).
- Ajout d'un manifest PWA + Service Worker pour le fonctionnement hors ligne.


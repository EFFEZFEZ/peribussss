# Données GTFS et GeoJSON

Placez vos fichiers ici pour que l'application puisse les charger.

## 📁 Structure attendue

```
/public/data/
  ├── gtfs/
  │   ├── routes.txt          (Obligatoire)
  │   ├── trips.txt           (Obligatoire)
  │   ├── stop_times.txt      (Obligatoire)
  │   ├── stops.txt           (Obligatoire)
  │   ├── calendar.txt        (Optionnel)
  │   └── shapes.txt          (Optionnel)
  └── map.geojson             (Obligatoire pour l'affichage des lignes)
```

## 📋 Fichiers GTFS requis

### routes.txt
Définit les lignes de bus
- `route_id` - Identifiant unique de la ligne
- `route_short_name` - Nom court (ex: "12")
- `route_long_name` - Nom complet (ex: "Gare - Centre Ville")
- `route_color` - Couleur en hexadécimal (optionnel)

### trips.txt
Définit les courses individuelles
- `trip_id` - Identifiant unique de la course
- `route_id` - Référence vers routes.txt
- `trip_headsign` - Destination affichée

### stop_times.txt
Définit les horaires à chaque arrêt
- `trip_id` - Référence vers trips.txt
- `arrival_time` - Heure d'arrivée (HH:MM:SS)
- `departure_time` - Heure de départ (HH:MM:SS)
- `stop_id` - Référence vers stops.txt
- `stop_sequence` - Ordre de l'arrêt dans la course

### stops.txt
Définit les arrêts
- `stop_id` - Identifiant unique de l'arrêt
- `stop_name` - Nom de l'arrêt
- `stop_lat` - Latitude
- `stop_lon` - Longitude

## 🗺️ Fichier GeoJSON

Le fichier `map.geojson` doit contenir les tracés des lignes de bus au format GeoJSON.

Exemple de structure:
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "name": "Ligne 12",
        "route_id": "12",
        "color": "#ff5722"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [2.3522, 48.8566],
          [2.3530, 48.8575]
        ]
      }
    }
  ]
}
```

## 🚀 Après avoir ajouté vos fichiers

1. Rafraîchissez la page web
2. L'application chargera automatiquement vos données
3. Cliquez sur "Play" pour voir les bus en mouvement

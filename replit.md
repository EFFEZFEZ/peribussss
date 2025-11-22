# GTFS Bus Visualization Application

## Vue d'ensemble

Application web interactive de visualisation en temps réel des positions de bus basée sur des données GTFS et GeoJSON. L'application affiche une carte OpenStreetMap avec des bus animés qui se déplacent selon leurs horaires GTFS.

## Architecture du Projet

```
/
├── public/                     # Fichiers statiques servis au navigateur
│   ├── index.html             # Page HTML principale
│   ├── style.css              # Styles CSS
│   ├── data/                  # Données GTFS et GeoJSON (fournis par l'utilisateur)
│   │   ├── gtfs/              # Fichiers GTFS (routes.txt, trips.txt, etc.)
│   │   └── map.geojson        # Tracés des lignes de bus
│   └── js/                    # Modules JavaScript ES6
│       ├── main.js            # Point d'entrée et orchestration
│       ├── dataManager.js     # Chargement et parsing GTFS/GeoJSON
│       ├── timeManager.js     # Gestion du temps simulé
│       ├── tripScheduler.js   # Calcul des trajets actifs
│       ├── busPositionCalculator.js  # Interpolation des positions
│       └── mapRenderer.js     # Rendu Leaflet et marqueurs
└── replit.md                  # Cette documentation
```

## Technologies Utilisées

- **Frontend**: HTML5, CSS3, JavaScript ES6 Modules
- **Cartographie**: Leaflet.js + OpenStreetMap
- **Parsing CSV**: PapaParse
- **Serveur**: Python HTTP Server (pour servir les fichiers statiques)

## Fonctionnalités Principales

1. **Carte Interactive**
   - Zoom et déplacement fluides
   - Affichage des tracés de lignes (GeoJSON)
   - Marqueurs animés pour chaque bus actif

2. **Horloge en Temps Réel**
   - Horloge toujours synchronisée avec l'heure actuelle
   - Affichage des bus en circulation selon les horaires GTFS
   - Mise à jour automatique chaque seconde

3. **Informations en Temps Réel**
   - Popup sur clic de bus (ligne, destination, ETA)
   - Compteur de bus actifs / total

4. **Animation Fluide**
   - Interpolation linéaire entre arrêts
   - Mise à jour en temps réel des positions
   - Transition douce des marqueurs

## Comment Utiliser

1. **Préparer les données**:
   - Placer les fichiers GTFS dans `/public/data/gtfs/`
   - Placer le fichier GeoJSON dans `/public/data/map.geojson`

2. **Démarrer l'application**:
   - Le serveur HTTP Python est configuré pour servir depuis `/public/`
   - Accéder à l'application via le navigateur Replit

3. **Utiliser l'application**:
   - L'application démarre automatiquement à l'heure actuelle
   - Utiliser "Filtrer" pour sélectionner les lignes à afficher
   - Cliquer sur les bus pour voir leurs détails
   - L'affichage se met à jour automatiquement chaque seconde

## Modules JavaScript

### main.js
Orchestre toute l'application, initialise les modules, configure les événements UI.

### dataManager.js
- Charge les fichiers GTFS (CSV) avec PapaParse
- Charge le fichier GeoJSON
- Crée des index pour accès rapide aux données
- Fournit des méthodes de requête pour routes, trips, stops

### timeManager.js
- Gère le temps simulé avec une horloge interne
- Contrôles: play, pause, reset, setSpeed
- Notifie les listeners à chaque mise à jour

### tripScheduler.js
- Calcule quels trips sont actifs à un instant T
- Détermine entre quels arrêts se trouve chaque bus
- Calcule la progression sur chaque segment

### busPositionCalculator.js
- Interpole les positions GPS le long des tracés GeoJSON
- Suit les routes réelles au lieu d'une ligne droite entre arrêts
- Fallback vers interpolation linéaire si pas de tracé disponible
- Utilise la progression pour un mouvement fluide
- Calcule l'orientation du bus (bearing)

### mapRenderer.js
- Initialise la carte Leaflet
- Affiche les routes GeoJSON
- Crée et met à jour les marqueurs de bus
- Gère les popups et interactions

## Format des Données GTFS

L'application attend les fichiers GTFS standards:
- `routes.txt` - Définition des lignes
- `trips.txt` - Courses individuelles
- `stop_times.txt` - Horaires aux arrêts
- `stops.txt` - Coordonnées des arrêts

## État Actuel

- ✅ Architecture modulaire complète
- ✅ Chargement GTFS et GeoJSON
- ✅ Simulation temporelle avec contrôles
- ✅ **Calcul des positions le long des tracés GeoJSON réels**
- ✅ **Les bus suivent les routes exactes au lieu de lignes droites**
- ✅ Rendu sur carte Leaflet
- ✅ Popups avec informations détaillées
- ✅ Interface utilisateur responsive

## Dernières Modifications (05/11/2025)

### Version 7.0 - Simplification et Optimisation
- 🧹 **Interface épurée** : Suppression des marqueurs d'arrêts/terminus pour une carte plus propre
- ⚡ **Code optimisé** : Nettoyage complet du code mort (gestion de vitesse, marqueurs inutilisés)
- 🎯 **Focus sur l'essentiel** : Interface minimaliste centrée sur la visualisation des bus en mouvement
- ⏰ **Mode temps réel permanent** : L'application affiche toujours l'heure actuelle, plus de mode simulation
- ✅ **Stabilité améliorée** : Tests et validation de toutes les fonctionnalités après optimisation

### Version 6.0 - Système de Catégorisation des Lignes
- 📂 **Organisation par catégories** : Les lignes sont maintenant classées selon la structure officielle de Péribus
- 🎨 **Code couleur** : Chaque catégorie a sa propre couleur distinctive
- ⚡ **Filtrage par catégorie** : Boutons pour sélectionner/désélectionner toute une catégorie en un clic
- 📊 **Interface améliorée** : Panneau de filtrage restructuré pour une meilleure lisibilité

### Version 2.0 - Filtrage et Rendu Multi-Couleurs
- 🎯 **Filtrage des lignes**: Panel de filtrage avec cases à cocher pour afficher/masquer des lignes spécifiques
- 🌈 **Rendu multi-couleurs des routes**: Quand plusieurs lignes partagent le même segment, les couleurs sont divisées proportionnellement
- ⚡ **Mise à jour en temps réel des popups**: Les informations de bus (prochain arrêt, ETA) se mettent à jour automatiquement sans re-clic
- 🔢 **Recalcul dynamique**: Les dimensions des routes s'ajustent automatiquement selon le nombre de lignes visibles
- 📊 **Compteur amélioré**: Affiche le nombre de bus visibles / total

### Version 1.0 - Base
- ✨ **Amélioration majeure**: Les bus suivent maintenant les tracés GeoJSON des routes
- 🛣️ Interpolation intelligente le long des routes réelles
- 🔄 Fallback automatique vers interpolation linéaire si pas de tracé disponible
- ⚡ Performances optimisées pour flottes de taille moyenne
- 🎨 **Chaque ligne affiche sa propre couleur** au lieu du bleu par défaut
- 🏷️ Popups améliorés avec badge coloré de la ligne
- 🎯 Filtrage intelligent pour n'afficher que les tracés des routes (LineString)

## Fonctionnalités Avancées

### Filtrage des Lignes par Catégories
L'application dispose d'un panneau de filtrage accessible via le bouton "Filtrer". Les lignes sont organisées par catégories selon la structure officielle de Péribus :

**Catégories disponibles :**
- 🔵 **Lignes majeures** : A, B, C, D
- 🔴 **Lignes express** : e1, e4, e5, e6, e7
- 🟢 **Lignes de quartier** : K1A, K1B, K2, K3A, K3B, K4A, K4B, K5, K6
- 🟣 **Lignes de rabattement** : R1 à R14
- 🟡 **Navettes** : N, N1

**Fonctionnalités du filtre :**
- Afficher/masquer des lignes individuellement
- Sélectionner/désélectionner toute une catégorie avec les boutons "Tous/Aucun"
- Voir le nombre de bus visibles sur le total en haut de la page
- Code couleur pour identifier rapidement chaque catégorie

### Rendu Multi-Couleurs
Quand plusieurs lignes partagent le même segment de route, l'application :
- Divise automatiquement la largeur de la route par le nombre de lignes
- Affiche chaque ligne avec sa couleur propre côte à côte
- Recalcule les dimensions quand vous filtrez des lignes
- Affiche toutes les lignes dans le popup quand vous cliquez sur un segment partagé

### Mise à Jour en Temps Réel
Les popups de bus se mettent à jour automatiquement toutes les secondes :
- Le prochain arrêt change quand le bus avance
- L'ETA (temps d'arrivée estimé) diminue en temps réel
- Pas besoin de fermer et rouvrir le popup

## Voies de Bus Dédiées

**Note sur les voies de bus** : L'application utilise actuellement les tracés GeoJSON fournis pour positionner les bus sur la carte. Pour une représentation plus précise prenant en compte les voies de bus dédiées :

1. **Données GeoJSON séparées** : Créez des tracés GeoJSON distincts pour :
   - Les voies de bus dédiées (bus-only lanes)
   - Les routes partagées avec le trafic général

2. **Propriétés recommandées** : Ajoutez dans vos fichiers GeoJSON :
   ```json
   {
     "properties": {
       "route_id": "12",
       "bus_lane": true,
       "lane_type": "dedicated|shared|mixed"
     }
   }
   ```

3. **Amélioration future** : Le système de rendu multi-couleurs pourrait être étendu pour :
   - Afficher les voies dédiées avec un style distinct
   - Calculer des temps de parcours différents selon le type de voie
   - Prendre en compte les restrictions de circulation

## Prochaines Améliorations Possibles

- ✅ ~~Support du filtrage des lignes visibles~~ (Implémenté)
- ✅ ~~Rendu multi-couleurs pour routes partagées~~ (Implémenté)
- ✅ ~~Mise à jour en temps réel des popups~~ (Implémenté)
- ✅ ~~Affichage des arrêts sur la carte avec popups~~ (Implémenté)
- ✅ ~~Organisation des lignes par catégories~~ (Implémenté)
- Support de calendar.txt pour filtrer par jour
- Mode replay avec timeline et historique
- Optimisation pour très grands réseaux (>200 bus)
- Export de captures d'état et statistiques
- Gestion des voies de bus dédiées avec tracés séparés
- Calcul de temps de parcours basé sur le trafic

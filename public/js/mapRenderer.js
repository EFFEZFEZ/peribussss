/**
 * mapRenderer.js - VERSION V24 (Solution Popup Indépendant)
 *
 * *** SOLUTION DÉFINITIVE V24 ***
 * - Le bug est que marker.bindPopup() est incompatible
 * avec setLatLng() appelé à chaque tick.
 *
 * - SOLUTION :
 * 1. Ne PLUS utiliser marker.bindPopup().
 * 2. Créer UN SEUL popup global (this.busPopup).
 * 3. Utiliser marker.on('click') pour ouvrir ce popup global.
 * 4. Mettre à jour la position du marqueur ET du popup
 * séparément dans updateBusMarkers().
 *
 * - RÉSULTAT :
 * Le bus bouge (setLatLng sur le marqueur).
 * Le popup suit (setLatLng sur le popup).
 * L'ETA se met à jour (setContent sur le popup).
 * ZÉRO CLIGNOTEMENT.
 *
 * *** MODIFICATION V57 (Géolocalisation) ***
 * 1. Ajout de `userLocationMarker` et `locateControl` au constructeur.
 * 2. Ajout de `addLocateControl()` pour initialiser L.Control.Locate.
 * 3. Ajout de `updateUserLocation()` pour afficher/déplacer le point bleu.
 * 4. Ajout de `onLocateError()` pour gérer les erreurs.
 * 5. Ajout de `panToUserLocation()` pour centrer la carte.
 */

export class MapRenderer {
    /**
     * @param {string} mapElementId - L'ID de l'élément HTML de la carte
     * @param {DataManager} dataManager - L'instance de DataManager
     * @param {TimeManager} timeManager - L'instance de TimeManager
     */
    constructor(mapElementId, dataManager, timeManager) {
        this.mapElementId = mapElementId;
        this.map = null;
        this.busMarkers = {}; // Garde la trace de nos marqueurs (clé: tripId)
        this.routeLayer = null;
        this.routeLayersById = {};
        this.selectedRoute = null;
        this.centerCoordinates = [45.1833, 0.7167]; // Périgueux
        this.zoomLevel = 16;
        this.tempStopMarker = null;

        this.stopLayer = null;

        /* Garder une référence aux managers */
        this.dataManager = dataManager;
        this.timeManager = timeManager;

        /* V24 - Initialisation du Popup Indépendant */
        this.busPopup = null;
        this.busPopupDomElement = null; // Le DOM stable (V18)
        this.selectedBusId = null; // Savoir quel bus est cliqué

        /* ✅ V57 - Géolocalisation */
        this.userLocationMarker = null; // Le "point bleu"
        this.locateControl = null; // Le contrôle Leaflet.Locate

        /* Initialisation du groupe de clusters */
        this.clusterGroup = L.markerClusterGroup({
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            disableClusteringAtZoom: 16 
        });
    }

    /**
     * Initialise la carte Leaflet
     */
    initializeMap(useClusters = true) {
        this.map = L.map(this.mapElementId, {
            zoomControl: false // ✅ V57: On désactive le zoom par défaut pour le repositionner
        }).setView(this.centerCoordinates, this.zoomLevel);
        
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(this.map);
        
        // ✅ V57: Ajout du contrôle de zoom en haut à droite
        L.control.zoom({ position: 'topright' }).addTo(this.map);

        /* Initialisation des couches */
        this.stopLayer = L.layerGroup().addTo(this.map);
        
        if (useClusters) {
            this.map.addLayer(this.clusterGroup);
        }
        
        console.log(`🗺️ Carte ${this.mapElementId} initialisée`);
        this.map.on('click', () => {
            if (this.tempStopMarker) {
                this.map.removeLayer(this.tempStopMarker);
                this.tempStopMarker = null;
            }
        });

        /* V24 - Créer le popup global et son DOM */
        this.busPopupDomElement = this.createBusPopupDomElement(); // Crée la structure
        this.busPopup = L.popup({
            autoClose: true,
            closeOnClick: true,
            closeButton: true,
            autoPan: true
        });

        // Quand le popup est fermé, on désélectionne le bus
        this.busPopup.on('remove', () => {
            this.selectedBusId = null;
        });
    }

    offsetPoint(lat1, lon1, lat2, lon2, offsetMeters, index, total) {
        const earthRadius = 6371000;
        const lat1Rad = lat1 * Math.PI / 180;
        const lon1Rad = lon1 * Math.PI / 180;
        const lat2Rad = lat2 * Math.PI / 180;
        const lon2Rad = lon2 * Math.PI / 180;
        const bearing = Math.atan2(
            Math.sin(lon2Rad - lon1Rad) * Math.cos(lat2Rad),
            Math.cos(lat1Rad) * Math.sin(lat2Rad) - 
            Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(lon2Rad - lon1Rad)
        );
        const perpBearing = bearing + Math.PI / 2;
        const offsetDistance = offsetMeters * (index - (total - 1) / 2);
        const angularDistance = offsetDistance / earthRadius;
        const newLat = Math.asin(
            Math.sin(lat1Rad) * Math.cos(angularDistance) +
            Math.cos(lat1Rad) * Math.sin(angularDistance) * Math.cos(perpBearing)
        );
        const newLon = lon1Rad + Math.atan2(
            Math.sin(perpBearing) * Math.sin(angularDistance) * Math.cos(lat1Rad),
            Math.cos(angularDistance) - Math.sin(lat1Rad) * Math.sin(newLat)
        );
        return [newLat * 180 / Math.PI, newLon * 180 / Math.PI];
    }
    
    offsetLineString(coordinates, offsetMeters, index, total) {
        const offsetCoords = [];
        for (let i = 0; i < coordinates.length; i++) {
            const [lon, lat] = coordinates[i];
            let lon2, lat2;
            if (i < coordinates.length - 1) {
                [lon2, lat2] = coordinates[i + 1];
            } else {
                [lon2, lat2] = coordinates[i - 1];
            }
            const [newLat, newLon] = this.offsetPoint(lat, lon, lat2, lon2, offsetMeters, index, total);
            offsetCoords.push([newLon, newLat]);
        }
        return offsetCoords;
    }
    
    displayMultiColorRoutes(geoJsonData, dataManager, visibleRoutes) {
        if (!geoJsonData) {
            console.warn('Aucune donnée GeoJSON à afficher');
            return;
        }
        if (this.routeLayer) {
            this.map.removeLayer(this.routeLayer);
        }
        this.routeLayer = L.layerGroup().addTo(this.map);
        this.routeLayersById = {};
        const geometryMap = new Map();
        geoJsonData.features.forEach(feature => {
            if (feature.geometry && feature.geometry.type === 'LineString') {
                const routeId = feature.properties?.route_id;
                if (!visibleRoutes.has(routeId)) {
                    return;
                }
                const geomKey = JSON.stringify(feature.geometry.coordinates);
                if (!geometryMap.has(geomKey)) {
                    geometryMap.set(geomKey, []);
                }
                geometryMap.get(geomKey).push(feature);
            }
        });
        geometryMap.forEach((features, geomKey) => {
            const numRoutes = features.length;
            const baseWidth = 4;
            const offsetMeters = 3;
            if (numRoutes === 1) {
                const feature = features[0];
                const routeColor = feature.properties?.route_color || '#3388ff';
                const routeId = feature.properties?.route_id;
                const layer = L.geoJSON(feature, {
                    style: {
                        color: routeColor,
                        weight: baseWidth,
                        opacity: 0.85,
                        lineCap: 'round',
                        lineJoin: 'round'
                    }
                });
                if (routeId) {
                    if (!this.routeLayersById[routeId]) this.routeLayersById[routeId] = [];
                    this.routeLayersById[routeId].push(layer);
                }
                this.addRoutePopup(layer, features, dataManager);
                layer.addTo(this.routeLayer);
            } else {
                features.forEach((feature, index) => {
                    const routeColor = feature.properties?.route_color || '#3388ff';
                    const routeId = feature.properties?.route_id;
                    const offsetCoords = this.offsetLineString(
                        feature.geometry.coordinates,
                        offsetMeters,
                        index,
                        numRoutes
                    );
                    const offsetFeature = {
                        type: 'Feature',
                        geometry: {
                            type: 'LineString',
                            coordinates: offsetCoords
                        },
                        properties: feature.properties
                    };
                    const layer = L.geoJSON(offsetFeature, {
                        style: {
                            color: routeColor,
                            weight: baseWidth,
                            opacity: 0.85,
                            lineCap: 'round',
                            lineJoin: 'round'
                        }
                    });
                    if (routeId) {
                        if (!this.routeLayersById[routeId]) this.routeLayersById[routeId] = [];
                        this.routeLayersById[routeId].push(layer);
                    }
                    layer.addTo(this.routeLayer);
                    this.addRoutePopup(layer, features, dataManager);
                });
            }
        });
    }
    
    addRoutePopup(layer, features, dataManager) {
        let content = '<b>Ligne(s) sur ce tracé:</b><br>';
        const routeNames = new Set();
        features.forEach(feature => {
            const routeId = feature.properties?.route_id;
            const route = dataManager.getRoute(routeId);
            if (route) {
                routeNames.add(route.route_short_name || routeId);
            }
        });
        content += Array.from(routeNames).join(', ');
        layer.bindPopup(content);
    }

    /**
     * V24 - Logique de Popup Indépendant
     */
    updateBusMarkers(busesWithPositions, tripScheduler, currentSeconds) {
        const markersToAdd = [];
        const markersToRemove = [];
        const activeBusIds = new Set();
        
        // 1. Trouver les marqueurs à supprimer
        busesWithPositions.forEach(bus => activeBusIds.add(bus.tripId));

        Object.keys(this.busMarkers).forEach(busId => {
            if (!activeBusIds.has(busId)) {
                // Si le bus sélectionné disparaît, fermer le popup
                if (busId === this.selectedBusId) {
                    this.busPopup.close();
                    this.selectedBusId = null;
                }
                const markerData = this.busMarkers[busId];
                markersToRemove.push(markerData.marker);
                delete this.busMarkers[busId];
            }
        });

        // 2. Mettre à jour les marqueurs existants et ajouter les nouveaux
        busesWithPositions.forEach(bus => {
            const busId = bus.tripId;
            if (!busId) return;
            
            const { lat, lon } = bus.position;
            
            if (this.busMarkers[busId]) {
                // Marqueur existant
                const markerData = this.busMarkers[busId];
                markerData.bus = bus;
                
                // On met TOUJOURS à jour la position du marqueur
                markerData.marker.setLatLng([lat, lon]);

            } else {
                // Nouveau marqueur
                const markerData = this.createBusMarker(bus, tripScheduler, busId);
                this.busMarkers[busId] = markerData;
                if (this.clusterGroup) {
                    markersToAdd.push(markerData.marker);
                } else {
                    markerData.marker.addTo(this.map);
                }
            }
        });
        
        // 3. (V24) Mettre à jour le popup s'il est ouvert
        if (this.selectedBusId && this.busMarkers[this.selectedBusId]) {
            const selectedMarkerData = this.busMarkers[this.selectedBusId];
            
            // Mettre à jour le contenu
            this.updateBusPopupContent(this.busPopupDomElement, selectedMarkerData.bus, tripScheduler);
            
            // Mettre à jour la position du popup
            this.busPopup.setLatLng(selectedMarkerData.marker.getLatLng());
        }

        // Nettoyage final des couches
        if (this.clusterGroup) {
            if (markersToRemove.length > 0) {
                this.clusterGroup.removeLayers(markersToRemove);
            }
            if (markersToAdd.length > 0) {
                this.clusterGroup.addLayers(markersToAdd);
            }
        } else {
             if (markersToRemove.length > 0) {
                markersToRemove.forEach(m => this.map.removeLayer(m));
            }
        }
    }

    /**
     * V24 - Mise à jour du DOM du popup global
     */
    updateBusPopupContent(domElement, bus, tripScheduler) {
        try {
            const route = bus.route;
            const routeShortName = route?.route_short_name || route?.route_id || '?';
            const routeColor = route?.route_color ? `#${route.route_color}` : '#3B82F6';
            const textColor = route?.route_text_color ? `#${route.route_text_color}` : '#ffffff';
            
            const stopTimes = tripScheduler.dataManager.stopTimesByTrip[bus.tripId];
            const destination = tripScheduler.getTripDestination(stopTimes);
            const nextStopName = bus.segment?.toStopInfo?.stop_name || 'Inconnu';
            const nextStopETA = tripScheduler.getNextStopETA(bus.segment, bus.currentSeconds);

            const stateText = `En Ligne (vers ${destination})`;
            const nextStopText = nextStopName;
            const etaText = nextStopETA ? nextStopETA.formatted : '...';

            // Sélectionne les éléments à mettre à jour
            const headerEl = domElement.querySelector('.info-popup-header');
            const stateEl = domElement.querySelector('[data-update="state"]');
            const nextStopEl = domElement.querySelector('[data-update="next-stop-value"]');
            const etaEl = domElement.querySelector('[data-update="eta-value"]');

            // Mettre à jour le Header (couleur + texte)
            if (headerEl) {
                headerEl.style.background = routeColor;
                headerEl.style.color = textColor;
                headerEl.textContent = `Ligne ${routeShortName}`;
            }

            // Mettre à jour le contenu
            if (stateEl && stateEl.textContent !== stateText) stateEl.textContent = stateText;
            if (nextStopEl && nextStopEl.textContent !== nextStopText) nextStopEl.textContent = nextStopText;
            if (etaEl && etaEl.textContent !== etaText) etaEl.textContent = etaText;
            
        } catch (e) {
            console.error("Erreur mise à jour popup:", e);
        }
    }

    /**
     * V24 - Crée la STRUCTURE DOM (vide) du popup global
     */
    createBusPopupDomElement() {
        const container = document.createElement('div');
        container.className = 'info-popup-content';

        // Header
        const header = document.createElement('div');
        header.className = 'info-popup-header';
        container.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'info-popup-body bus-details';

        // Statut
        const statusP = document.createElement('p');
        statusP.innerHTML = '<strong>Statut: </strong><span data-update="state">Chargement...</span>';
        body.appendChild(statusP);

        // Prochain arrêt
        const nextStopP = document.createElement('p');
        nextStopP.innerHTML = '<strong data-update="next-stop-label">Prochain arrêt : </strong><span data-update="next-stop-value">...</span>';
        body.appendChild(nextStopP);

        // Arrivée
        const etaP = document.createElement('p');
        const etaValue = document.createElement('span');
        etaValue.setAttribute('data-update', 'eta-value');
        etaValue.textContent = '...';
        etaValue.style.fontVariantNumeric = 'tabular-nums'; 
        etaValue.style.display = 'inline-block';
        etaValue.style.minWidth = '80px';
        
        etaP.innerHTML = '<strong data-update="eta-label">Arrivée : </strong>';
        etaP.appendChild(etaValue);
        body.appendChild(etaP);
        
        // Notice temps réel
        const noticeP = document.createElement('p');
        noticeP.className = 'realtime-notice';
        noticeP.innerHTML = '<em>Mise à jour en temps réel</em>';
        body.appendChild(noticeP);

        container.appendChild(body);

        return container;
    }

    /**
     * V24 - Crée un marqueur et lui attache un 'click' event
     */
    createBusMarker(bus, tripScheduler, busId) {
        const { lat, lon } = bus.position;
        const route = bus.route;
        const routeShortName = route?.route_short_name || route?.route_id || '?';
        const routeColor = route?.route_color ? `#${route.route_color}` : '#FFC107';
        const textColor = route?.route_text_color ? `#${route.route_text_color}` : '#ffffff';

        const iconClassName = 'bus-icon-rect';
        const statusClass = bus.currentStatus ? `bus-status-${bus.currentStatus}` : 'bus-status-normal';

        const icon = L.divIcon({
            className: `${iconClassName} ${statusClass}`,
            html: `<div style="background-color: ${routeColor}; color: ${textColor};">${routeShortName}</div>`,
            iconSize: [40, 24],
            iconAnchor: [20, 12],
            popupAnchor: [0, -12] // Gardé pour info, mais plus de popup lié
        });

        const marker = L.marker([lat, lon], { icon });
        
        // *** V24 - NE PAS UTILISER bindPopup ***
        // marker.bindPopup(...);
        
        // Attacher un simple 'click'
        marker.on('click', () => {
            this.selectedBusId = busId;
            const markerData = this.busMarkers[busId];
            
            // Mettre à jour le contenu AVANT de l'ouvrir
            this.updateBusPopupContent(this.busPopupDomElement, markerData.bus, tripScheduler);
            
            // Ouvrir le popup global
            this.busPopup
                .setLatLng(marker.getLatLng())
                .setContent(this.busPopupDomElement)
                .openOn(this.map);
        });
        
        // Créer l'objet markerData (sans popupDomElement, car il est global)
        const markerData = {
            marker: marker,
            bus: bus
        };

        return markerData;
    }

    /**
     * Surligne un tracé sur la carte
     */
    highlightRoute(routeId, state) {
        if (!this.routeLayersById || !this.routeLayersById[routeId]) return;
        const weight = state ? 6 : 4; 
        const opacity = state ? 1 : 0.85;
        this.routeLayersById[routeId].forEach(layer => {
            layer.setStyle({ weight: weight, opacity: opacity });
            if (state) {
                layer.bringToFront(); 
            }
        });
    }

    /**
     * Zoome sur un tracé de ligne
     */
    zoomToRoute(routeId) {
        if (!this.routeLayersById || !this.routeLayersById[routeId] || this.routeLayersById[routeId].length === 0) {
            console.warn(`Aucune couche trouvée pour zoomer sur la route ${routeId}`);
            return;
        }
        const routeGroup = L.featureGroup(this.routeLayersById[routeId]);
        const bounds = routeGroup.getBounds();
        if (bounds && bounds.isValid()) {
            this.map.fitBounds(bounds, { padding: [50, 50] });
        }
    }

    /**
     * Zoome sur un arrêt
     */
    zoomToStop(stop) {
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        if (isNaN(lat) || isNaN(lon)) return;
        this.map.setView([lat, lon], 17);
        if (this.tempStopMarker) {
            this.map.removeLayer(this.tempStopMarker);
        }
        const stopIcon = L.divIcon({
            className: 'stop-search-marker',
            html: `<div></div>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6]
        });
        this.tempStopMarker = L.marker([lat, lon], { icon: stopIcon }).addTo(this.map);
    }

    /**
     * Affiche les "master stops" sur la carte, si le zoom est suffisant
     */
    displayStops(minZoom = 13) { 
        this.stopLayer.clearLayers(); 

        const currentZoom = this.map.getZoom();
        if (currentZoom < minZoom) {
            return; 
        }

        const stopIcon = L.divIcon({
            className: 'stop-marker-icon', // Style défini dans style.css
            iconSize: [10, 10],
            iconAnchor: [5, 5]
        });

        const stopsToDisplay = [];
        this.dataManager.masterStops.forEach(stop => {
            const lat = parseFloat(stop.stop_lat);
            const lon = parseFloat(stop.stop_lon);
            if (isNaN(lat) || isNaN(lon)) return;

            // zIndexOffset -100 pour que les bus passent TOUJOURS au-dessus
            const marker = L.marker([lat, lon], { icon: stopIcon, zIndexOffset: -100 });
            
            /* Attache un événement au lieu d'un popup statique */
            marker.on('click', () => this.onStopClick(stop));
            
            stopsToDisplay.push(marker);
        });

        stopsToDisplay.forEach(marker => this.stopLayer.addLayer(marker));
    }

    /**
     * Appelé lorsqu'un marqueur d'arrêt est cliqué
     */
    onStopClick(masterStop) {
        const currentSeconds = this.timeManager.getCurrentSeconds();
        const currentDate = this.timeManager.getCurrentDate();

        const associatedStopIds = this.dataManager.groupedStopMap[masterStop.stop_id] || [masterStop.stop_id];

        const departures = this.dataManager.getUpcomingDepartures(associatedStopIds, currentSeconds, currentDate, 5);

        const popupContent = this.createStopPopupContent(masterStop, departures, currentSeconds);
        
        const lat = parseFloat(masterStop.stop_lat);
        const lon = parseFloat(masterStop.stop_lon);
        L.popup()
            .setLatLng([lat, lon])
            .setContent(popupContent)
            .openOn(this.map);
    }

    /**
     * Formate le contenu HTML pour le popup d'un arrêt
     */
    createStopPopupContent(masterStop, departures, currentSeconds) {
        let html = `<div class="info-popup-content">`;
        html += `<div class="info-popup-header">${masterStop.stop_name}</div>`;
        html += `<div class="info-popup-body">`; // Corrigé: class. au lieu de class=

        if (departures.length === 0) {
            html += `<div class="departure-item empty">Aucun prochain passage trouvé.</div>`;
        } else {
            departures.forEach(dep => {
                const waitSeconds = dep.departureSeconds - currentSeconds;
                let waitTime = "";
                if (waitSeconds >= 0) {
                    const waitMinutes = Math.floor(waitSeconds / 60);
                    if (waitMinutes === 0) {
                        waitTime = `<span class="wait-time imminent">Imminent</span>`;
                    } else {
                        waitTime = `<span class="wait-time">${waitMinutes} min</span>`;
                    }
                }

                html += `
                    <div class="departure-item">
                        <div class="departure-info">
                            <span class="departure-badge" style="background-color: #${dep.routeColor}; color: #${dep.routeTextColor};">
                                ${dep.routeShortName}
                            </span>
                            <span class="departure-dest">${dep.destination}</span>
                        </div>
                        <div class="departure-time">
                            <strong>${dep.time.substring(0, 5)}</strong>
                            ${waitTime}
                        </div>
                    </div>
                `;
            });
        }

        html += `</div></div>`;
        return html;
    }


    /* =========================================
     * ✅ NOUVELLES FONCTIONS V57 (GÉOLOCALISATION)
     * ========================================= */

    /**
     * Ajoute le contrôle de géolocalisation à la carte
     * @param {function} onSuccess - Callback de succès (appelé par main.js)
     * @param {function} onError - Callback d'erreur (appelé par main.js)
     */
    addLocateControl(onSuccess, onError) {
        if (!this.map || !L.control.locate) {
            console.warn("Leaflet.locate n'est pas chargé. Impossible d'ajouter le contrôle.");
            return;
        }
        
        this.locateControl = L.control.locate({
            position: 'topright',
            strings: {
                title: "Me localiser"
            },
            flyTo: true,
            keepCurrentZoomLevel: true,
            markerClass: L.Marker, // Utilise un marqueur standard (qu'on va cacher)
            markerStyle: {
                opacity: 0, // Cache le marqueur par défaut
                interactive: false
            },
            circleStyle: {
                opacity: 0, // Cache le cercle de précision
                fillOpacity: 0
            },
            locateOptions: {
                enableHighAccuracy: true
            },
            // Utilise notre SVG personnalisé pour le bouton
            // (Note: La bibliothèque utilise <a>, donc on met le SVG dedans)
            createButtonCallback: (container, options) => {
                const link = L.DomUtil.create('a', 'leaflet-bar-part leaflet-bar-part-single leaflet-control-locate', container);
                link.href = '#';
                link.title = options.strings.title;
                link.setAttribute('role', 'button');
                link.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L7 12l10 0L12 2z"/><circle cx="12" cy="12" r="10"/></svg>`;
                return link;
            }
        }).addTo(this.map);

        // Lier les événements du contrôle aux callbacks de main.js
        this.map.on('locationfound', (e) => {
            this.locateControl.stop(); // Arrête l'animation
            
            // On appelle la fonction de succès de main.js
            onSuccess({ coords: { latitude: e.latitude, longitude: e.longitude } });
            
            // Centre la carte sur la nouvelle position
            this.panToUserLocation();
        });

        this.map.on('locationerror', (e) => {
            onError(e); // Appelle la fonction d'erreur de main.js
        });
    }

    /**
     * Met à jour la position du "point bleu" de l'utilisateur sur la carte
     * @param {object} coords - { lat, lng }
     */
    updateUserLocation(coords) {
        if (!this.map) return;

        const latLng = [coords.lat, coords.lng];

        if (!this.userLocationMarker) {
            // Créer le marqueur "point bleu"
            const userIcon = L.divIcon({
                className: 'user-location-marker',
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });
            this.userLocationMarker = L.marker(latLng, { 
                icon: userIcon,
                zIndexOffset: 1000 // Toujours au-dessus
            }).addTo(this.map);
        } else {
            // Simplement mettre à jour sa position
            this.userLocationMarker.setLatLng(latLng);
        }
    }

    /**
     * Gère les erreurs de localisation (ex: permission refusée)
     */
    onLocateError() {
        if (this.locateControl) {
            this.locateControl.stop(); // Arrête l'animation de chargement
        }
    }

    /**
     * Centre la carte sur la position de l'utilisateur (si connue)
     */
    panToUserLocation() {
        if (this.userLocationMarker) {
            const latLng = this.userLocationMarker.getLatLng();
            this.map.flyTo(latLng, Math.max(this.map.getZoom(), 17)); // Zoome si nécessaire
        } else if (this.locateControl) {
            // Si le marqueur n'existe pas encore, demande à Leaflet-Locate de le faire
            this.locateControl.start();
        }
    }
}

const GTFS_TRIPS_CACHE_TTL_MS = 60 * 1000; // 60s cache

export const HYBRID_ROUTING_CONFIG = Object.freeze({
    STOP_SEARCH_RADIUS_M: 500,
    STOP_SEARCH_LIMIT: 12,
    MAX_ITINERARIES: 12,
    WALK_DIRECT_MAX_METERS: 100,
    ENABLE_TRANSFERS: true,
    TRANSFER_MAX_ITINERARIES: 6,
    TRANSFER_MIN_BUFFER_SECONDS: 180,
    TRANSFER_MAX_WAIT_SECONDS: 2700,
    TRANSFER_MAX_FIRST_LEG_STOPS: 12,
    TRANSFER_CANDIDATE_TRIPS_LIMIT: 60
});

const AVERAGE_WALK_SPEED_MPS = 1.35; // ~4.8 km/h

export function createRouterContext({ dataManager, apiManager, icons }) {
    const placeIdCache = new Map();
    const gtfsTripsCache = new Map();

    const getWalkingRoute = (startPoint, endPoint) => getWalkingRouteInternal({ dataManager, apiManager, placeIdCache }, startPoint, endPoint);
    const getCachedTripsBetweenStops = (startIds, endIds, reqDate, windowStartSec, windowEndSec) =>
        getCachedTripsBetweenStopsInternal({ dataManager, gtfsTripsCache }, startIds, endIds, reqDate, windowStartSec, windowEndSec);

    return {
        computeHybridItinerary: (fromCoordsRaw, toCoordsRaw, searchTime, labels = {}) =>
            computeHybridItineraryInternal({
                dataManager,
                icons,
                config: HYBRID_ROUTING_CONFIG,
                getWalkingRoute,
                getCachedTripsBetweenStops,
                encodePolyline,
                computeWalkDurationSeconds
            }, fromCoordsRaw, toCoordsRaw, searchTime, labels)
    };
}

function computeWalkDurationSeconds(distanceMeters) {
    if (!distanceMeters || Number.isNaN(distanceMeters)) return 0;
    return Math.max(30, Math.round(distanceMeters / AVERAGE_WALK_SPEED_MPS));
}

export function encodePolyline(points) {
    const encodeSigned = (num) => {
        let sgnNum = Math.round(num * 1e5);
        sgnNum = sgnNum < 0 ? ~(sgnNum << 1) : sgnNum << 1;
        let out = '';
        while (sgnNum >= 0x20) {
            out += String.fromCharCode((0x20 | (sgnNum & 0x1f)) + 63);
            sgnNum >>= 5;
        }
        out += String.fromCharCode(sgnNum + 63);
        return out;
    };

    let lastLat = 0;
    let lastLng = 0;
    let result = '';
    for (const [lat, lng] of points) {
        const latE5 = Math.round(lat * 1e5);
        const lngE5 = Math.round(lng * 1e5);
        const dLat = latE5 - lastLat;
        const dLng = lngE5 - lastLng;
        result += encodeSigned(dLat);
        result += encodeSigned(dLng);
        lastLat = latE5;
        lastLng = lngE5;
    }
    return result;
}

export function decodePolyline(encoded) {
    if (!encoded) return [];
    const poly = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;
    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;
        shift = 0;
        result = 0;
        do {
            b = encoded.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;
        poly.push([lat / 1e5, lng / 1e5]);
    }
    return poly;
}

async function getWalkingRouteInternal(context, startPoint, endPoint) {
    const { dataManager, apiManager } = context;
    if (!startPoint || !endPoint) return null;
    const distance = dataManager.calculateDistance(startPoint.lat, startPoint.lon, endPoint.lat, endPoint.lon);
    if (!distance || Number.isNaN(distance)) return null;

    if (distance <= HYBRID_ROUTING_CONFIG.WALK_DIRECT_MAX_METERS) {
        const encoded = encodePolyline([[startPoint.lat, startPoint.lon], [endPoint.lat, endPoint.lon]]);
        return {
            encodedPolyline: encoded,
            distanceMeters: Math.round(distance),
            durationSeconds: computeWalkDurationSeconds(distance),
            source: 'direct'
        };
    }

    try {
        const startPid = await getCachedPlaceIdInternal(context, startPoint.lat, startPoint.lon);
        const endPid = await getCachedPlaceIdInternal(context, endPoint.lat, endPoint.lon);
        if (startPid && endPid) {
            const walkData = await apiManager.fetchWalkingRoute(startPid, endPid);
            const route = walkData.routes?.[0];
            const encoded = route?.polyline?.encodedPolyline || route?.polyline;
            if (encoded) {
                const durationSec = parseInt(route?.duration?.replace('s', ''), 10);
                return {
                    encodedPolyline: encoded,
                    distanceMeters: Math.round(route?.distanceMeters || distance),
                    durationSeconds: durationSec && !Number.isNaN(durationSec) ? durationSec : computeWalkDurationSeconds(distance),
                    source: 'api'
                };
            }
        }
    } catch (err) {
        console.warn('Erreur getWalkingRoute, fallback segment direct:', err);
    }

    const fallbackEncoded = encodePolyline([[startPoint.lat, startPoint.lon], [endPoint.lat, endPoint.lon]]);
    return {
        encodedPolyline: fallbackEncoded,
        distanceMeters: Math.round(distance),
        durationSeconds: computeWalkDurationSeconds(distance),
        source: 'fallback'
    };
}

async function getCachedPlaceIdInternal(context, lat, lon) {
    const { apiManager, placeIdCache } = context;
    const key = `${lat},${lon}`;
    if (placeIdCache.has(key)) return placeIdCache.get(key);
    try {
        const pid = await apiManager.reverseGeocode(lat, lon);
        if (pid) placeIdCache.set(key, pid);
        return pid;
    } catch (e) {
        console.warn('reverseGeocode failed for', key, e);
        return null;
    }
}

function getCachedTripsBetweenStopsInternal(context, startIds, endIds, reqDate, windowStartSec, windowEndSec) {
    const { dataManager, gtfsTripsCache } = context;
    try {
        const key = JSON.stringify({ startIds: startIds.slice().sort(), endIds: endIds.slice().sort(), date: reqDate.toISOString().split('T')[0], windowStartSec, windowEndSec });
        const now = Date.now();
        const cached = gtfsTripsCache.get(key);
        if (cached && (now - cached.ts) < GTFS_TRIPS_CACHE_TTL_MS) {
            return cached.value;
        }
        const result = dataManager.getTripsBetweenStops(startIds, endIds, reqDate, windowStartSec, windowEndSec) || [];
        gtfsTripsCache.set(key, { ts: now, value: result });
        return result;
    } catch (err) {
        console.warn('getCachedTripsBetweenStops error', err);
        return dataManager.getTripsBetweenStops(startIds, endIds, reqDate, windowStartSec, windowEndSec) || [];
    }
}

async function computeHybridItineraryInternal(context, fromCoordsRaw, toCoordsRaw, searchTime, labels = {}) {
    const dataManager = context.dataManager;
    const ICONS = context.icons;
    const HYBRID_ROUTING_CONFIG = context.config;
    const getWalkingRoute = context.getWalkingRoute;
    const getCachedTripsBetweenStops = context.getCachedTripsBetweenStops;
    const encodePolyline = context.encodePolyline;
    const computeWalkDurationSeconds = context.computeWalkDurationSeconds;

    if (!dataManager || !dataManager.isLoaded) return [];

    const normalizeCoords = (coord) => {
        if (!coord) return null;
        const lat = parseFloat(coord.lat ?? coord.latitude);
        const lon = parseFloat(coord.lon ?? coord.lng ?? coord.longitude);
        if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
        return { lat, lon };
    };

    const origin = normalizeCoords(fromCoordsRaw);
    const destination = normalizeCoords(toCoordsRaw);

    const toPoint = (stop) => {
        if (!stop) return null;
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
        return { lat, lon };
    };

    const MAX_STOP_RADIUS_METERS = HYBRID_ROUTING_CONFIG.STOP_SEARCH_RADIUS_M || 1200;
    const MAX_STOP_CANDIDATES = HYBRID_ROUTING_CONFIG.STOP_SEARCH_LIMIT || 5;

    const normalizeText = (value) => (value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .trim();

    const findStopsByLabel = (label, limit = MAX_STOP_CANDIDATES * 2) => {
        if (!label) return [];
        const directMatches = (dataManager.findStopsByName && dataManager.findStopsByName(label, limit)) || [];
        if (directMatches.length) return directMatches.slice(0, limit);
        const normalizedLabel = normalizeText(label);
        if (!normalizedLabel) return [];
        const fallback = [];
        for (const stop of dataManager.stops) {
            if (fallback.length >= limit) break;
            const stopName = normalizeText(stop.stop_name);
            if (stopName && stopName.includes(normalizedLabel)) {
                fallback.push(stop);
            }
        }
        return fallback;
    };

    const collectStopsWithinRadius = (point, label, nameHint) => {
        const candidates = [];
        const seenIds = new Set();
        const addCandidate = (stop, distance) => {
            if (!stop || seenIds.has(stop.stop_id)) return;
            seenIds.add(stop.stop_id);
            candidates.push({ stop, distance: Number.isFinite(distance) ? distance : null });
        };

        if (point) {
            for (const stop of dataManager.stops) {
                const lat = parseFloat(stop.stop_lat);
                const lon = parseFloat(stop.stop_lon);
                if (Number.isNaN(lat) || Number.isNaN(lon)) continue;
                const dist = dataManager.calculateDistance(point.lat, point.lon, lat, lon);
                if (Number.isNaN(dist) || dist > MAX_STOP_RADIUS_METERS) continue;
                addCandidate(stop, dist);
                if (candidates.length >= MAX_STOP_CANDIDATES) break;
            }
        }

        const nameFallback = nameHint || label;
        if ((!point || candidates.length === 0) && nameFallback) {
            const namedStops = findStopsByLabel(nameFallback);
            namedStops.forEach((stop, index) => {
                const dist = point
                    ? dataManager.calculateDistance(point.lat, point.lon, parseFloat(stop.stop_lat), parseFloat(stop.stop_lon))
                    : (index * 50);
                addCandidate(stop, dist);
            });
        }

        if (!point && candidates.length === 0) {
            console.warn(`⚠️ Hybrid: aucun repère géographique pour ${label}, utilisation d'un fallback par lignes principales.`);
            dataManager.stops.slice(0, MAX_STOP_CANDIDATES).forEach(stop => addCandidate(stop, null));
        }

        if (!candidates.length) {
            console.warn(`⚠️ Hybrid: aucun arrêt trouvé pour ${label}.`);
            return [];
        }

        candidates.sort((a, b) => {
            const distA = (a.distance == null) ? Infinity : a.distance;
            const distB = (b.distance == null) ? Infinity : b.distance;
            if (distA === distB) {
                return (a.stop.stop_name || '').localeCompare(b.stop.stop_name || '');
            }
            return distA - distB;
        });

        const limited = candidates.slice(0, MAX_STOP_CANDIDATES);
        const best = limited[0];
        if (best) {
            const distanceLabel = (best.distance != null) ? `${Math.round(best.distance)} m` : 'distance inconnue';
            console.log(`🔎 Hybrid: ${limited.length} arrêt(s) candidats pour ${label}. Meilleur: ${best.stop.stop_name} (${distanceLabel}).`);
        }
        return limited;
    };

    const buildRequestedDate = () => {
        try {
            let baseDate;
            if (!searchTime?.date || searchTime.date === 'today' || searchTime.date === "Aujourd'hui") {
                baseDate = new Date();
            } else {
                baseDate = new Date(searchTime.date);
            }
            const hour = parseInt(searchTime?.hour, 10) || 0;
            const minute = parseInt(searchTime?.minute, 10) || 0;
            baseDate.setHours(hour, minute, 0, 0);
            return baseDate;
        } catch (err) {
            console.warn('⚠️ Hybrid: date invalide, utilisation de la date courante.', err);
            return new Date();
        }
    };

    const originCandidates = collectStopsWithinRadius(origin, 'l’origine', labels?.fromLabel || labels?.fromName);
    const destCandidates = collectStopsWithinRadius(destination, 'la destination', labels?.toLabel || labels?.toName);
    if (!originCandidates.length || !destCandidates.length) return [];

    const reqDate = buildRequestedDate();

    const geometryToLatLngs = (geometry) => {
        if (!geometry) return null;
        const toLatLng = (pair) => [pair[1], pair[0]]; // [lat, lng]
        if (Array.isArray(geometry)) {
            if (!geometry.length) return null;
            if (typeof geometry[0][0] === 'number') {
                return geometry.map(toLatLng);
            }
            if (Array.isArray(geometry[0])) {
                return geometry.flat().map(toLatLng);
            }
        }
        if (geometry.type === 'LineString') {
            return geometry.coordinates.map(toLatLng);
        }
        if (geometry.type === 'MultiLineString') {
            return geometry.coordinates.flat().map(toLatLng);
        }
        return null;
    };

    const findIndexOnPolyline = (points, targetPoint) => {
        if (!points || !targetPoint) return null;
        let bestIdx = null;
        let bestDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const dist = dataManager.calculateDistance(targetPoint.lat, targetPoint.lon, points[i][0], points[i][1]);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }
        return bestIdx;
    };

    const slicePolylineBetween = (points, startPoint, endPoint) => {
        if (!points || points.length < 2 || !startPoint || !endPoint) return null;
        const startIdx = findIndexOnPolyline(points, startPoint);
        const endIdx = findIndexOnPolyline(points, endPoint);
        if (startIdx == null || endIdx == null) {
            return null;
        }
        if (startIdx === endIdx) {
            return [points[startIdx], points[endIdx]];
        }
        if (startIdx < endIdx) {
            return points.slice(startIdx, endIdx + 1);
        }
        const reversed = points.slice(endIdx, startIdx + 1).reverse();
        return reversed;
    };

    const buildBusLegStep = (segment, boardingStop, alightingStop) => {
        if (!segment || !boardingStop || !alightingStop) return null;
        const boardingPoint = toPoint(boardingStop);
        const alightingPoint = toPoint(alightingStop);
        if (!boardingPoint || !alightingPoint) return null;

        let geometry = null;
        if (segment.shapeId) {
            geometry = dataManager.getShapeGeoJSON(segment.shapeId, segment.routeId);
        }
        if (!geometry) {
            geometry = dataManager.getRouteGeometry(segment.routeId);
        }

        let latLngPolyline = geometryToLatLngs(geometry);
        let slicedPolyline = slicePolylineBetween(latLngPolyline, boardingPoint, alightingPoint);
        if (!slicedPolyline || slicedPolyline.length < 2) {
            slicedPolyline = [
                [boardingPoint.lat, boardingPoint.lon],
                [alightingPoint.lat, alightingPoint.lon]
            ];
        }
        const busPolylineEncoded = encodePolyline(slicedPolyline.map(pair => [pair[0], pair[1]]));

        const durationSeconds = Math.max(0, segment.arrivalSeconds - segment.departureSeconds);
        const intermediateStops = (segment.stopTimes || [])
            .slice(1, -1)
            .map(st => dataManager.getStop(st.stop_id)?.stop_name || st.stop_id);
        const route = segment.route || dataManager.getRoute(segment.routeId);
        const busStep = {
            type: 'BUS',
            icon: ICONS.BUS,
            instruction: `Prendre ${route?.route_short_name || segment.routeId}`,
            polyline: { encodedPolyline: busPolylineEncoded },
            routeColor: route?.route_color ? `#${route.route_color}` : '#3388ff',
            routeTextColor: route?.route_text_color ? `#${route.route_text_color}` : '#ffffff',
            routeShortName: route?.route_short_name || segment.routeId,
            departureStop: boardingStop?.stop_name || 'Arrêt de départ',
            arrivalStop: alightingStop?.stop_name || 'Arrêt d’arrivée',
            departureTime: dataManager.formatTime(segment.departureSeconds),
            arrivalTime: dataManager.formatTime(segment.arrivalSeconds),
            duration: dataManager.formatDuration(durationSeconds) || 'Horaires théoriques',
            intermediateStops,
            numStops: Math.max(0, (segment.stopTimes || []).length - 1),
            _durationSeconds: durationSeconds
        };

        return {
            step: busStep,
            summary: {
                type: 'BUS',
                name: route?.route_short_name || segment.routeId,
                color: route?.route_color ? `#${route.route_color}` : '#3388ff',
                textColor: route?.route_text_color ? `#${route.route_text_color}` : '#ffffff'
            }
        };
    };

    const assembleTransferItinerary = async ({
        firstSegment,
        secondSegment,
        boardingStop,
        transferStop,
        finalStop,
        origin,
        destination,
        originCandidates,
        destCandidates,
        windowStartSec,
        windowEndSec
    }) => {
        if (!firstSegment || !secondSegment || !boardingStop || !transferStop || !finalStop) return null;

        const originMatch = originCandidates.find(c => c.stop.stop_id === boardingStop.stop_id);
        const destMatch = destCandidates.find(c => c.stop.stop_id === finalStop.stop_id);

        const itinerary = {
            type: 'BUS',
            steps: [],
            summarySegments: [],
            transfers: 1,
            tripId: `${firstSegment.tripId}+${secondSegment.tripId}`,
            route: secondSegment.route
        };

        const boardingPoint = toPoint(boardingStop);
        const finalPoint = toPoint(finalStop);
        if (!boardingPoint || !finalPoint) return null;

        const approachLabel = boardingStop?.stop_name ? `Marcher jusqu’à ${boardingStop.stop_name}` : 'Marcher jusqu’à l’arrêt';
        const approachStep = await buildWalkStep(approachLabel, origin, boardingPoint);
        if (approachStep) {
            itinerary.steps.push(approachStep);
        }

        const firstLeg = buildBusLegStep(firstSegment, boardingStop, transferStop);
        if (!firstLeg) return null;
        itinerary.steps.push(firstLeg.step);
        itinerary.summarySegments.push(firstLeg.summary);

        const waitSeconds = Math.max(0, secondSegment.departureSeconds - firstSegment.arrivalSeconds);
        if (waitSeconds >= 60) {
            itinerary.steps.push({
                type: 'WAIT',
                icon: ICONS.statusWarning,
                instruction: `Correspondance à ${transferStop.stop_name}`,
                duration: `${Math.max(1, Math.round(waitSeconds / 60))} min`,
                _durationSeconds: waitSeconds
            });
        }

        const secondLeg = buildBusLegStep(secondSegment, transferStop, finalStop);
        if (!secondLeg) return null;
        itinerary.steps.push(secondLeg.step);
        itinerary.summarySegments.push(secondLeg.summary);

        const egressStep = await buildWalkStep('Marcher jusqu’à destination', finalPoint, destination);
        if (egressStep) {
            itinerary.steps.push(egressStep);
        }

        itinerary.departureTime = dataManager.formatTime(firstSegment.departureSeconds);
        itinerary.arrivalTime = dataManager.formatTime(secondSegment.arrivalSeconds);

        const totalDurationSeconds =
            (approachStep?._durationSeconds || 0) +
            (firstLeg.step?._durationSeconds || 0) +
            waitSeconds +
            (secondLeg.step?._durationSeconds || 0) +
            (egressStep?._durationSeconds || 0);

        itinerary.duration = totalDurationSeconds > 0 ? dataManager.formatDuration(totalDurationSeconds) : 'Horaires théoriques';
        itinerary._hybridDiagnostics = {
            boardingStopId: boardingStop.stop_id,
            transferStopId: transferStop.stop_id,
            alightingStopId: finalStop.stop_id,
            firstTripId: firstSegment.tripId,
            secondTripId: secondSegment.tripId,
            transfers: 1,
            startDistanceMeters: (originMatch && originMatch.distance != null) ? Math.round(originMatch.distance) : null,
            endDistanceMeters: (destMatch && destMatch.distance != null) ? Math.round(destMatch.distance) : null,
            requestedWindow: { start: windowStartSec, end: windowEndSec },
            candidateStartStopIds: Array.from(startStopSet),
            candidateEndStopIds: Array.from(endStopSet)
        };

        itinerary._transferInfo = {
            waitMinutes: Math.round(waitSeconds / 60),
            transferStopName: transferStop.stop_name
        };

        return itinerary;
    };

    const buildTransferItineraries = async ({
        origin,
        destination,
        originCandidates,
        destCandidates,
        startStopSet,
        endStopSet,
        expandedEndIds,
        reqDate,
        windowStartSec,
        windowEndSec
    }) => {
        if (!HYBRID_ROUTING_CONFIG.ENABLE_TRANSFERS) return [];
        const transferResults = [];
        const serviceSet = dataManager.getServiceIds(reqDate);
        if (!serviceSet || serviceSet.size === 0) return transferResults;

        const isServiceActive = (trip) => Array.from(serviceSet).some(activeServiceId => dataManager.serviceIdsMatch(trip.service_id, activeServiceId));

        const candidateTrips = [];
        for (const trip of dataManager.trips) {
            if (!isServiceActive(trip)) continue;
            const stopTimes = dataManager.stopTimesByTrip[trip.trip_id];
            if (!stopTimes || stopTimes.length < 2) continue;
            for (let i = 0; i < stopTimes.length - 1; i++) {
                const st = stopTimes[i];
                if (!startStopSet.has(st.stop_id)) continue;
                const departureSeconds = dataManager.timeToSeconds(st.departure_time || st.arrival_time);
                if (!Number.isFinite(departureSeconds)) continue;
                if (departureSeconds < windowStartSec || departureSeconds > windowEndSec) continue;
                candidateTrips.push({
                    trip,
                    stopTimes,
                    boardingIndex: i,
                    departureSeconds
                });
                break;
            }
            if (candidateTrips.length >= HYBRID_ROUTING_CONFIG.TRANSFER_CANDIDATE_TRIPS_LIMIT) {
                break;
            }
        }

        candidateTrips.sort((a, b) => a.departureSeconds - b.departureSeconds);

        const seenPairs = new Set();

        for (const candidate of candidateTrips) {
            if (transferResults.length >= HYBRID_ROUTING_CONFIG.TRANSFER_MAX_ITINERARIES) break;

            const boardingStopTime = candidate.stopTimes[candidate.boardingIndex];
            const boardingStop = dataManager.getStop(boardingStopTime.stop_id);
            if (!boardingStop) continue;

            const maxTransferIdx = Math.min(candidate.stopTimes.length - 1, candidate.boardingIndex + HYBRID_ROUTING_CONFIG.TRANSFER_MAX_FIRST_LEG_STOPS);

            for (let idx = candidate.boardingIndex + 1; idx <= maxTransferIdx; idx++) {
                if (transferResults.length >= HYBRID_ROUTING_CONFIG.TRANSFER_MAX_ITINERARIES) break;

                const transferStopTime = candidate.stopTimes[idx];
                const transferStop = dataManager.getStop(transferStopTime.stop_id);
                if (!transferStop) continue;

                const arrivalSeconds = dataManager.timeToSeconds(transferStopTime.arrival_time || transferStopTime.departure_time);
                const departSeconds = dataManager.timeToSeconds(transferStopTime.departure_time || transferStopTime.arrival_time);
                if (!Number.isFinite(arrivalSeconds) || !Number.isFinite(departSeconds)) continue;
                const earliestSecondLeg = departSeconds + HYBRID_ROUTING_CONFIG.TRANSFER_MIN_BUFFER_SECONDS;
                if (earliestSecondLeg > 86400) break;
                const latestSecondLeg = Math.min(earliestSecondLeg + HYBRID_ROUTING_CONFIG.TRANSFER_MAX_WAIT_SECONDS, 86400);

                const secondTrips = getCachedTripsBetweenStops([
                    transferStop.stop_id
                ], expandedEndIds, reqDate, earliestSecondLeg, latestSecondLeg);
                if (!secondTrips || !secondTrips.length) continue;

                const firstSegment = {
                    tripId: candidate.trip.trip_id,
                    routeId: candidate.trip.route_id,
                    route: dataManager.getRoute(candidate.trip.route_id),
                    shapeId: candidate.trip.shape_id || null,
                    boardingStopId: boardingStop.stop_id,
                    alightingStopId: transferStop.stop_id,
                    departureSeconds: candidate.departureSeconds,
                    arrivalSeconds,
                    stopTimes: candidate.stopTimes.slice(candidate.boardingIndex, idx + 1)
                };

                for (const second of secondTrips) {
                    if (transferResults.length >= HYBRID_ROUTING_CONFIG.TRANSFER_MAX_ITINERARIES) break;
                    if (second.tripId === firstSegment.tripId) continue;
                    const dedupeKey = `${firstSegment.tripId}->${second.tripId}`;
                    if (seenPairs.has(dedupeKey)) continue;

                    const finalStop = dataManager.getStop(second.alightingStopId);
                    if (!finalStop) continue;

                    const itinerary = await assembleTransferItinerary({
                        firstSegment,
                        secondSegment: second,
                        boardingStop,
                        transferStop,
                        finalStop,
                        origin,
                        destination,
                        originCandidates,
                        destCandidates,
                        windowStartSec,
                        windowEndSec
                    });

                    if (itinerary) {
                        seenPairs.add(dedupeKey);
                        transferResults.push(itinerary);
                    }
                }
            }
        }

        return transferResults;
    };

    const buildWalkStep = async (instruction, startPoint, endPoint) => {
        if (!startPoint || !endPoint) return null;
        try {
            const routeData = await getWalkingRoute(startPoint, endPoint);
            if (!routeData || !routeData.distanceMeters || routeData.distanceMeters < 1) {
                return null;
            }

            const durationSeconds = routeData.durationSeconds ?? computeWalkDurationSeconds(routeData.distanceMeters);
            return {
                type: 'WALK',
                icon: ICONS.WALK,
                instruction,
                polylines: routeData.encodedPolyline ? [{ encodedPolyline: routeData.encodedPolyline }] : [],
                subSteps: [],
                totalDistanceMeters: Math.round(routeData.distanceMeters),
                departureTime: '~',
                arrivalTime: '~',
                duration: durationSeconds ? `${Math.max(1, Math.round(durationSeconds / 60))} min` : '—',
                _durationSeconds: durationSeconds,
                _source: routeData.source || 'direct'
            };
        } catch (err) {
            console.warn('Erreur buildWalkStep (hybrid):', err);
            return null;
        }
    };

    const reqSeconds = (reqDate.getHours() * 3600) + (reqDate.getMinutes() * 60);
    const TWO_HOURS = 2 * 3600;
    let windowStartSec = reqSeconds;
    let windowEndSec = Math.min(86400, reqSeconds + TWO_HOURS);
    if (searchTime?.type === 'arriver') {
        windowEndSec = reqSeconds;
        windowStartSec = Math.max(0, reqSeconds - TWO_HOURS);
    }
    if (windowEndSec <= windowStartSec) {
        windowEndSec = Math.min(86400, windowStartSec + TWO_HOURS);
    }

    const resolveClusterIds = (stop) => {
        const ids = new Set();
        if (!stop) return ids;
        const parent = stop.parent_station && stop.parent_station.trim() ? stop.parent_station.trim() : null;
        if (parent && dataManager.groupedStopMap[parent]) {
            dataManager.groupedStopMap[parent].forEach(id => ids.add(id));
        }
        if (dataManager.groupedStopMap[stop.stop_id]) {
            dataManager.groupedStopMap[stop.stop_id].forEach(id => ids.add(id));
        }
        ids.add(stop.stop_id);
        return ids;
    };

    const startStopSet = new Set();
    originCandidates.forEach(candidate => {
        resolveClusterIds(candidate.stop).forEach(id => startStopSet.add(id));
    });

    const endStopSet = new Set();
    destCandidates.forEach(candidate => {
        resolveClusterIds(candidate.stop).forEach(id => endStopSet.add(id));
    });

    const expandedStartIds = Array.from(startStopSet);
    const expandedEndIds = Array.from(endStopSet);

    const trips = getCachedTripsBetweenStops(
        expandedStartIds,
        expandedEndIds,
        reqDate,
        windowStartSec,
        windowEndSec
    );
    const itineraries = [];

    if (trips && trips.length) {
        const selected = trips.slice(0, HYBRID_ROUTING_CONFIG.MAX_ITINERARIES);
        for (const tripCandidate of selected) {
            try {
                const boardingStop = dataManager.getStop(tripCandidate.boardingStopId) || originCandidates[0]?.stop;
                const alightingStop = dataManager.getStop(tripCandidate.alightingStopId) || destCandidates[0]?.stop;
                const boardingPoint = toPoint(boardingStop);
                const alightingPoint = toPoint(alightingStop);
                if (!boardingPoint || !alightingPoint) continue;

                const itinerary = {
                    type: 'BUS',
                    tripId: tripCandidate.tripId,
                    route: tripCandidate.route,
                    steps: [],
                    summarySegments: []
                };

                const approachLabel = boardingStop?.stop_name ? `Marcher jusqu’à ${boardingStop.stop_name}` : 'Marcher jusqu’à l’arrêt';
                const approachStep = await buildWalkStep(approachLabel, origin, boardingPoint);
                if (approachStep) {
                    itinerary.steps.push(approachStep);
                }

                const busLeg = buildBusLegStep(tripCandidate, boardingStop, alightingStop);
                if (!busLeg) continue;
                itinerary.steps.push(busLeg.step);

                const egressStep = await buildWalkStep('Marcher jusqu’à destination', alightingPoint, destination);
                if (egressStep) {
                    itinerary.steps.push(egressStep);
                }

                itinerary.summarySegments.push(busLeg.summary);

                itinerary.departureTime = dataManager.formatTime(tripCandidate.departureSeconds);
                itinerary.arrivalTime = dataManager.formatTime(tripCandidate.arrivalSeconds);

                const totalDurationSeconds =
                    (approachStep?._durationSeconds || 0) +
                    (busLeg.step?._durationSeconds || 0) +
                    (egressStep?._durationSeconds || 0);
                itinerary.duration = totalDurationSeconds > 0 ? dataManager.formatDuration(totalDurationSeconds) : 'Horaires théoriques';
                const matchingOrigin = originCandidates.find(c => c.stop.stop_id === boardingStop?.stop_id);
                const matchingDest = destCandidates.find(c => c.stop.stop_id === alightingStop?.stop_id);
                itinerary._hybridDiagnostics = {
                    boardingStopId: boardingStop?.stop_id,
                    alightingStopId: alightingStop?.stop_id,
                    startDistanceMeters: (matchingOrigin && matchingOrigin.distance != null) ? Math.round(matchingOrigin.distance) : null,
                    endDistanceMeters: (matchingDest && matchingDest.distance != null) ? Math.round(matchingDest.distance) : null,
                    requestedWindow: { start: windowStartSec, end: windowEndSec },
                    candidateStartStopIds: expandedStartIds,
                    candidateEndStopIds: expandedEndIds
                };

                itineraries.push(itinerary);
            } catch (e) {
                console.warn('Erreur lors de la construction d\'un itinéraire hybride:', e);
            }
        }
    }

    if ((!trips || !trips.length) && HYBRID_ROUTING_CONFIG.ENABLE_TRANSFERS) {
        console.warn('⚠️ Hybrid: aucun trip direct trouvé, tentative avec correspondances.');
        const transferItins = await buildTransferItineraries({
            origin,
            destination,
            originCandidates,
            destCandidates,
            startStopSet,
            endStopSet,
            expandedEndIds,
            reqDate,
            windowStartSec,
            windowEndSec
        });
        itineraries.push(...transferItins);
    }

    if (!itineraries.length) {
        console.warn('⚠️ Hybrid: aucun itinéraire GTFS (direct ou correspondance) trouvé.');
        console.table({
            startCandidates: originCandidates.map(c => ({ id: c.stop.stop_id, name: c.stop.stop_name, dist: c.distance != null ? Math.round(c.distance) : null })),
            endCandidates: destCandidates.map(c => ({ id: c.stop.stop_id, name: c.stop.stop_name, dist: c.distance != null ? Math.round(c.distance) : null })),
            windowStartSec,
            windowEndSec
        });
    }

    return itineraries;
}

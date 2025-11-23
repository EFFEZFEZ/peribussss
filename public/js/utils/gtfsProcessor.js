const DEFAULT_DATASET = {
    routes: [],
    trips: [],
    stopTimes: [],
    stops: [],
    calendar: [],
    calendarDates: [],
    geoJson: null
};

export function cleanCsvValue(value) {
    if (typeof value !== 'string') {
        return value;
    }
    return value.replace(/^["']|["']$/g, '').trim();
}

export function cleanRecord(record = {}) {
    const cleaned = {};
    Object.keys(record).forEach((key) => {
        cleaned[key] = cleanCsvValue(record[key]);
    });
    return cleaned;
}

export function cleanDataset(dataset = {}) {
    const source = { ...DEFAULT_DATASET, ...dataset };
    return {
        routes: (source.routes || []).map(cleanRecord),
        trips: (source.trips || []).map(cleanRecord),
        stopTimes: (source.stopTimes || []).map(cleanRecord),
        stops: (source.stops || []).map(cleanRecord),
        calendar: (source.calendar || []).map(cleanRecord),
        calendarDates: (source.calendarDates || []).map(cleanRecord),
        geoJson: source.geoJson || null
    };
}

export function buildGtfsIndexes(dataset = {}) {
    const routesById = {};
    const routesByShortName = {};
    const stopsById = {};
    const stopsByName = {};
    const tripsByRoute = {};
    const tripsByTripId = {};
    const stopTimesByTrip = {};
    const stopTimesByStop = {};

    const routes = dataset.routes || [];
    const trips = dataset.trips || [];
    const stopTimes = dataset.stopTimes || [];
    const stops = dataset.stops || [];

    routes.forEach((route) => {
        routesById[route.route_id] = route;
        if (route.route_short_name) {
            routesByShortName[route.route_short_name] = route;
        }
    });

    stops.forEach((stop) => {
        stopsById[stop.stop_id] = stop;
        const normalizedName = normalizeStopName(stop.stop_name);
        if (!stopsByName[normalizedName]) {
            stopsByName[normalizedName] = [];
        }
        stopsByName[normalizedName].push(stop);
    });

    stopTimes.forEach((stopTime) => {
        if (!stopTimesByTrip[stopTime.trip_id]) {
            stopTimesByTrip[stopTime.trip_id] = [];
        }
        stopTimesByTrip[stopTime.trip_id].push(stopTime);
    });

    Object.keys(stopTimesByTrip).forEach((tripId) => {
        stopTimesByTrip[tripId].sort((a, b) => parseInt(a.stop_sequence, 10) - parseInt(b.stop_sequence, 10));
    });

    trips.forEach((trip) => {
        tripsByTripId[trip.trip_id] = trip;
        if (!tripsByRoute[trip.route_id]) {
            tripsByRoute[trip.route_id] = [];
        }
        tripsByRoute[trip.route_id].push(trip);
    });

    const { masterStops, groupedStopMap } = groupNearbyStops(stops);
    const processedStopTimesByStop = preprocessStopTimesByStop(stopTimes);

    return {
        routesById,
        routesByShortName,
        stopsById,
        stopsByName,
        tripsByRoute,
        tripsByTripId,
        stopTimesByTrip,
        stopTimesByStop: processedStopTimesByStop,
        groupedStopMap,
        masterStops
    };
}

function normalizeStopName(value) {
    if (!value) {
        return '';
    }
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .trim();
}

function groupNearbyStops(stops = []) {
    const masterStops = [];
    const groupedStopMap = {};
    const childStops = new Set();

    stops.forEach((stop) => {
        if (stop.parent_station && stop.parent_station.trim() !== '') {
            childStops.add(stop.stop_id);
        }
    });

    stops.forEach((stop) => {
        if (stop.location_type === '1') {
            masterStops.push(stop);
            if (!groupedStopMap[stop.stop_id]) {
                groupedStopMap[stop.stop_id] = [];
            }
            groupedStopMap[stop.stop_id].push(stop.stop_id);
        } else if (stop.parent_station && stop.parent_station.trim() !== '') {
            const parentId = stop.parent_station;
            if (!groupedStopMap[parentId]) {
                groupedStopMap[parentId] = [];
            }
            groupedStopMap[parentId].push(stop.stop_id);
        } else if (stop.location_type !== '1' && !childStops.has(stop.stop_id) && (!stop.parent_station || stop.parent_station.trim() === '')) {
            masterStops.push(stop);
            groupedStopMap[stop.stop_id] = [stop.stop_id];
        }
    });

    return { masterStops, groupedStopMap };
}

function preprocessStopTimesByStop(stopTimes = []) {
    const bucket = {};
    stopTimes.forEach((stopTime) => {
        if (!bucket[stopTime.stop_id]) {
            bucket[stopTime.stop_id] = [];
        }
        bucket[stopTime.stop_id].push(stopTime);
    });
    return bucket;
}

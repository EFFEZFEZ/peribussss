import { cleanDataset, buildGtfsIndexes } from '../utils/gtfsProcessor.js';

const OPTIMIZED_BUNDLE_PATH = '/data/gtfs/gtfs.bundle.json';
const GTFS_FILES = [
    { file: 'routes.txt', key: 'routes' },
    { file: 'trips.txt', key: 'trips' },
    { file: 'stop_times.txt', key: 'stopTimes' },
    { file: 'stops.txt', key: 'stops' },
    { file: 'calendar.txt', key: 'calendar' },
    { file: 'calendar_dates.txt', key: 'calendarDates' }
];

self.addEventListener('message', async (event) => {
    if (!event?.data || event.data.type !== 'load') {
        return;
    }

    try {
        postProgress('Chargement des données GTFS optimisées...');
        const dataset = await loadDataset();
        postProgress('Nettoyage des données...');
        const cleaned = cleanDataset(dataset);
        postProgress('Construction des index GTFS...');
        const indexes = buildGtfsIndexes(cleaned);
        self.postMessage({
            type: 'loaded',
            payload: {
                dataset: cleaned,
                indexes,
                source: dataset.__source || 'worker'
            }
        });
    } catch (error) {
        self.postMessage({ type: 'error', error: error?.message || 'Chargement GTFS impossible' });
    }
});

function postProgress(message) {
    self.postMessage({ type: 'progress', message });
}

async function loadDataset() {
    try {
        const response = await fetch(OPTIMIZED_BUNDLE_PATH, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error('Bundle optimisé indisponible');
        }
        const optimized = await response.json();
        optimized.__source = 'bundle';
        return optimized;
    } catch (bundleError) {
        console.warn('Bundle GTFS manquant, fallback CSV.', bundleError);
        return loadFromCsv();
    }
}

async function loadFromCsv() {
    const dataset = {};
    for (const { file, key } of GTFS_FILES) {
        postProgress(`Lecture de ${file}...`);
        dataset[key] = await fetchAndParseCsv(file);
    }
    dataset.geoJson = await loadGeoJson();
    dataset.__source = 'csv';
    return dataset;
}

async function fetchAndParseCsv(filename) {
    const response = await fetch(`/data/gtfs/${filename}`, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Impossible de charger ${filename}: ${response.statusText}`);
    }
    const text = await response.text();
    return parseCsv(text);
}

async function loadGeoJson() {
    try {
        const response = await fetch('/data/map.geojson', { cache: 'no-store' });
        if (!response.ok) {
            return null;
        }
        return await response.json();
    } catch (error) {
        console.warn('GeoJSON absent ou invalide.', error);
        return null;
    }
}

function parseCsv(text) {
    const rows = [];
    let current = '';
    let row = [];
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            row.push(current);
            current = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i++;
            }
            row.push(current);
            rows.push(row);
            row = [];
            current = '';
            continue;
        }

        current += char;
    }

    if (current !== '' || row.length) {
        row.push(current);
        rows.push(row);
    }

    if (!rows.length) {
        return [];
    }

    const headers = rows.shift().map((header) => header.trim());
    return rows.filter((cells) => cells.length && cells.some((value) => value && value.trim() !== ''))
        .map((cells) => {
            const record = {};
            headers.forEach((header, index) => {
                record[header] = cells[index] ?? '';
            });
            return record;
        });
}

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanDataset } from '../public/js/utils/gtfsProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GTFS_DIR = path.resolve(__dirname, '../public/data/gtfs');
const OUTPUT_FILE = path.join(GTFS_DIR, 'gtfs.bundle.json');
const GTFS_FILES = [
    { file: 'routes.txt', key: 'routes' },
    { file: 'trips.txt', key: 'trips' },
    { file: 'stop_times.txt', key: 'stopTimes' },
    { file: 'stops.txt', key: 'stops' },
    { file: 'calendar.txt', key: 'calendar' },
    { file: 'calendar_dates.txt', key: 'calendarDates' }
];

async function main() {
    console.log('➡️  Prétraitement des fichiers GTFS...');
    const dataset = {};

    for (const { file, key } of GTFS_FILES) {
        const filePath = path.join(GTFS_DIR, file);
        console.log(`   • ${file}`);
        const contents = await fs.readFile(filePath, 'utf8');
        dataset[key] = parseCsv(contents);
    }

    dataset.geoJson = await readGeoJson();
    const cleaned = cleanDataset(dataset);

    await fs.writeFile(OUTPUT_FILE, JSON.stringify(cleaned));
    console.log(`✅ Bundle GTFS généré: ${OUTPUT_FILE}`);
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
    return rows
        .filter((cells) => cells.length && cells.some((value) => value && value.trim() !== ''))
        .map((cells) => {
            const record = {};
            headers.forEach((header, index) => {
                record[header] = cells[index] ?? '';
            });
            return record;
        });
}

async function readGeoJson() {
    const geoPath = path.resolve(__dirname, '../public/data/map.geojson');
    try {
        const text = await fs.readFile(geoPath, 'utf8');
        return JSON.parse(text);
    } catch (error) {
        console.warn('GeoJSON non trouvé, ignoré.');
        return null;
    }
}

main().catch((error) => {
    console.error('❌ Prétraitement GTFS échoué:', error);
    process.exit(1);
});

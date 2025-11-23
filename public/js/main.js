/**
 * main.js - V58 (Partie 1/2 : Optimisation GPS & Debounce)
 *
 * *** MODIFICATION V58 (Optimisation GPS) ***
 * 1. Ajout de `lastGeocodeTime` et `lastGeocodePos` dans l'état global.
 * 2. Ajout de la fonction `getDistanceFromLatLonInM` pour calculer la distance en mètres.
 * 3. Réécriture de `onGeolocationSuccess` pour :
 * - Ignorer les mouvements < 10m (jitter GPS).
 * - Ne lancer le Reverse Geocoding (API payante) que si :
 * a) C'est la première fois.
 * b) On a bougé de > 200m.
 */
import { DataManager } from './dataManager.js';
import { TimeManager } from './timeManager.js';
import { TripScheduler } from './tripScheduler.js';
import { BusPositionCalculator } from './busPositionCalculator.js';
import { MapRenderer } from './mapRenderer.js';
import { ApiManager } from './apiManager.js';
import { createRouterContext, encodePolyline, decodePolyline } from './router.js';

// Remplacez cette chaîne par votre clé d'API Google Cloud restreinte par HTTP Referrer
const GOOGLE_API_KEY = "AIzaSyBYDN_8hSHSx_irp_fxLw--XyxuLiixaW4";

// Modules
let dataManager;
let timeManager;
let tripScheduler;
let busPositionCalculator;
let mapRenderer; // Carte temps réel
let detailMapRenderer; // Carte détail mobile
let resultsMapRenderer; // Carte résultats PC
let visibleRoutes = new Set();
let apiManager; 
let routerContext = null;

// Feature flags
let gtfsAvailable = true; // set to false if GTFS loading fails -> degraded API-only mode

// État global
let lineStatuses = {}; 
let currentDetailRouteLayer = null; // Tracé sur la carte détail mobile
let currentResultsRouteLayer = null; // Tracé sur la carte PC
let currentDetailMarkerLayer = null; // ✅ NOUVEAU V46.1
let currentResultsMarkerLayer = null; // ✅ NOUVEAU V46.1
let allFetchedItineraries = []; // Stocke tous les itinéraires (bus/vélo/marche)

// ✅ V57: État de la géolocalisation
let userLocation = null; // Va stocker { lat, lng }
let userPlaceId = null;  // Va stocker le place_id de la position
let isGeocoding = false; // Verrou pour éviter les appels multiples

// ✅ V58: État pour le Debounce GPS
let lastGeocodeTime = 0; // Timestamp du dernier appel API
let lastGeocodePos = null; // Position du dernier appel API

// ICÔNES SVG
const ICONS = {
    busSmall: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2l.64 2.54c.24.95-.54 1.96-1.54 1.96H4c-1 0-1.78-1.01-1.54-1.96L3 17h2"/><path d="M19 17V5c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v12h14z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>`,
    statusTriangle: `<svg width="16" height="8" viewBox="0 0 16 8" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M8 0L16 8H0L8 0Z" /></svg>`,
    statusWarning: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
    statusError: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>`,
    alertBanner: (type) => {
        if (type === 'annulation') return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
        if (type === 'retard') return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>`;
        return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
    },
    WALK: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.7 0-1.3.4-1.7 1L8 8.3C7.2 9.5 5.8 10 4 10v2c1.1 0 2.1-.4 2.8-1.1l1-1.6 1.4 6.3L8 17v6h2l1-9.6L13.5 15v-3.4l-3.7-3.7z"/></svg>`,
    BUS: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 17h2l.64 2.54c.24.95-.54 1.96-1.54 1.96H4c-1 0-1.78-1.01-1.54-1.96L3 17h2"/><path d="M19 17V5c0-1.1-.9-2-2-2H7c-1.1 0-2 .9-2 2v12h14z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>`,
    BICYCLE: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>`,
    ALL: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27z"/></svg>`,
    LEAF_ICON: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-4-4 1.41-1.41L10 16.17l6.59-6.59L18 11l-8 8z" opacity=".3"/><path d="M17.8 7.29c-.39-.39-1.02-.39-1.41 0L10 13.17l-1.88-1.88c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41l2.59 2.59c.39.39 1.02.39 1.41 0L17.8 8.7c.39-.39.39-1.02 0-1.41z" transform="translate(0, 0)" opacity=".1"/><path d="M12 4.14c-4.33 0-7.86 3.53-7.86 7.86s3.53 7.86 7.86 7.86 7.86-3.53 7.86-7.86S16.33 4.14 12 4.14zm5.8 4.57 c0 .28-.11.53-.29.71L12 15.01l-2.59-2.59c-.39-.39-1.02-.39-1.41 0-.39.39-.39 1.02 0 1.41l3.29 3.29c.39.39 1.02.39 1.41 0l6.29-6.29c.18-.18.29-.43.29-.71 0-1.04-1.2-1.57-2-1.57-.42 0-.8.13-1.1.33-.29.2-.6.4-.9.6z" fill="#1e8e3e"/></svg>`,
    GEOLOCATE: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8"/><line x1="12" y1="3" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="3" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="21" y2="12"/></svg>`,
    GEOLOCATE_SPINNER: `<div class="spinner"></div>`,
    MAP_LOCATE: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L7 12l10 0L12 2z"/><circle cx="12" cy="12" r="10"/></svg>`,
    MARKERS: {
        START: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#22c55e" stroke="#ffffff" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8m-4-4h8" stroke="#ffffff" stroke-width="2"/></svg>`,
        END: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="#ef4444" stroke="#ffffff" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 12h8" stroke="#ffffff" stroke-width="2"/></svg>`,
        CORRESPONDENCE: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#3b82f6" stroke="#ffffff" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>`
    },
    MANEUVER: {
        STRAIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><polyline points="19 12 12 19 5 12"></polyline></svg>`,
        TURN_LEFT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14 4 9 9 4"></polyline><path d="M20 20v-7a4 4 0 0 0-4-4H4"></path></svg>`,
        TURN_RIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 14 20 9 15 4"></polyline><path d="M4 20v-7a4 4 0 0 1 4-4h12"></path></svg>`,
        TURN_SLIGHT_LEFT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M17 5 9 13v7"></path><path d="m8 18 4-4"></path></svg>`,
        TURN_SLIGHT_RIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m7 5 8 8v7"></path><path d="m16 18-4-4"></path></svg>`,
        ROUNDABOUT_LEFT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M10 9.5c.1-.4.5-.8.9-1s1-.3 1.5-.3c.7 0 1.3.1 1.9.4c.6.3 1.1.7 1.5 1.1c.4.5.7 1 .8 1.7c.1.6.1 1.3 0 1.9c-.2.7-.4 1.3-.8 1.8c-.4.5-1 1-1.6 1.3c-.6.3-1.3.5-2.1.5c-.6 0-1.1-.1-1.6-.2c-.5-.1-1-.4-1.4-.7c-.4-.3-.7-.7-.9-1.1"></path><path d="m7 9 3-3 3 3"></path><circle cx="12" cy="12" r="10"></circle></svg>`,
        ROUNDABOUT_RIGHT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9.5c-.1-.4-.5-.8-.9-1s-1-.3-1.5-.3c-.7 0-1.3.1-1.9.4c-.6.3-1.1.7-1.5 1.1c-.4.5-.7 1-.8 1.7c-.1.6-.1 1.3 0 1.9c.2.7.4 1.3.8 1.8c.4.5 1 1 1.6 1.3c.6.3 1.3.5 2.1.5c.6 0 1.1-.1 1.6-.2c.5-.1 1-.4 1.4-.7c.4-.3.7-.7-.9-1.1"></path><path d="m17 9-3-3-3 3"></path><circle cx="12" cy="12" r="10"></circle></svg>`,
        DEFAULT: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="m12 16 4-4-4-4"></path><path d="M8 12h8"></path></svg>`
    }
};

/* ======================
 * UI Theme (Dark Mode)
 * - Persists user choice in localStorage ('ui-theme')
 * - Respects prefers-color-scheme when no saved choice
 * - Toggle button in header with id `theme-toggle-btn`
 * ======================
 */
function applyThemeState(useDarkParam) {
    const useDark = !!useDarkParam;
    document.body.classList.toggle('dark-theme', useDark);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
        btn.setAttribute('aria-pressed', useDark ? 'true' : 'false');
        btn.title = useDark ? 'Thème clair' : 'Thème sombre';
    }
    const icon = document.getElementById('theme-toggle-icon');
    if (icon) {
        icon.textContent = useDark ? '☀️' : '🌙';
    }

    try {
        ['map', 'detail-map', 'results-map'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('dark-theme', useDark);
        });
    } catch (e) { /* ignore */ }

    const themedRenderers = [
        typeof mapRenderer !== 'undefined' ? mapRenderer : null,
        typeof detailMapRenderer !== 'undefined' ? detailMapRenderer : null,
        typeof resultsMapRenderer !== 'undefined' ? resultsMapRenderer : null
    ].filter(Boolean);

    themedRenderers.forEach(renderer => {
        if (typeof renderer.applyTheme === 'function') {
            renderer.applyTheme(useDark);
            if (renderer.map) {
                renderer.map.invalidateSize();
            }
        }
    });
}

function initTheme() {
    try {
        const saved = localStorage.getItem('ui-theme');
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const useDark = saved ? (saved === 'dark') : prefersDark;
        applyThemeState(useDark);
    } catch (e) {
        console.warn('initTheme error', e);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Wire theme toggle
    const tbtn = document.getElementById('theme-toggle-btn');
    if (tbtn) {
        tbtn.addEventListener('click', () => {
            const nextIsDark = !document.body.classList.contains('dark-theme');
            applyThemeState(nextIsDark);
            try { localStorage.setItem('ui-theme', nextIsDark ? 'dark' : 'light'); } catch (e) { /* ignore */ }
        }, { passive: true });
    }

    // Initialize UI theme immediately (no preloader)
    initTheme();
});

// Mappage des noms de fichiers PDF
const PDF_FILENAME_MAP = {
    'A': 'grandperigueux_fiche_horaires_ligne_A_sept_2025.pdf',
    'B': 'grandperigueux_fiche_horaires_ligne_B_sept_2025.pdf',
    'C': 'grandperigueux_fiche_horaires_ligne_C_sept_2025.pdf',
    'D': 'grandperigueux_fiche_horaires_ligne_D_sept_2025.pdf',
    'e1': 'grandperigueux_fiche_horaires_ligne_e1_sept_2025.pdf',
    'e2': 'grandperigueux_fiche_horaires_ligne_e2_sept_2025.pdf',
    'e4': 'grandperigueux_fiche_horaires_ligne_e4_sept_2025.pdf',
    'e5': 'grandperigueux_fiche_horaires_ligne_e5_sept_2025.pdf',
    'e6': 'grandperigueux_fiche_horaires_ligne_e6_sept_2025.pdf',
    'e7': 'grandperigueux_fiche_horaires_ligne_e7_sept_2025.pdf',
    'K1A': 'grandperigueux_fiche_horaires_ligne_K1A_sept_2025.pdf',
    'K1B': 'grandperigueux_fiche_horaires_ligne_K1B_sept_2025.pdf',
    'K2': 'grandperigueux_fiche_horaires_ligne_K2_sept_2025.pdf',
    'K3A': 'grandperigueux_fiche_horaires_ligne_K3A_sept_2E025.pdf',
    'K3B': 'grandperigueux_fiche_horaires_ligne_K3B_sept_2025.pdf',
    'K4A': 'grandperigueux_fiche_horaires_ligne_K4A_sept_2025.pdf',
    'K4B': 'grandperigueux_fiche_horaires_ligne_K4B_sept_2025.pdf',
    'K5': 'grandperigueux_fiche_horaires_ligne_K5_sept_2025.pdf',
    'K6': 'grandperigueux_fiche_horaires_ligne_K6_sept_2025.pdf',
    'N': 'grandperigueux_fiche_horaires_ligne_N_sept_2025.pdf',
    'N1': 'grandperigueux_fiche_horaires_ligne_N1_sept_2025.pdf',
};

// Mappage des noms longs
const ROUTE_LONG_NAME_MAP = {
    'A': 'ZAE Marsac <> Centre Hospitalier',
    'B': 'Les Tournesols <> Gare SNCF',
    'C': 'ZAE Marsac <> P+R Aquacap',
    'D': 'P+R Charrieras <> Tourny',
    'e1': 'ZAE Marsac <> P+R Aquacap',
    'e2': 'Talleyrand Périgord <> Fromarsac',
    'e4': 'Charrieras <> La Feuilleraie <> Tourny',
    'e5': 'Les Tournesols <> PEM',
    'e6': 'Créavallée <> Trésorerie municipale',
    'e7': 'Notre-Dame de Sanilhac poste <> Les Lilas hôpital',
    'K1A': 'Maison Rouge <> Tourny / La Rudeille <> Tourny',
    'K1B': 'Le Lac <> Pôle universitaire Grenadière <> Taillefer',
    'K2': 'Champcevinel bourg <> Tourny',
    'K3A': 'La Feuilleraie <> Place du 8 mai',
    'K3B': 'Pépinière <> Place du 8 mai',
    'K4A': 'Sarrazi <> Dojo départemental <> Tourny',
    'K4B': 'Coulounieix bourg <> Tourny',
    'K5': 'Halte ferroviaire Boulazac <> La Feuilleraie',
    'K6': 'Halte ferroviaire Marsac sur l’Isle',
    'N': 'Tourny <> PEM',
    'N1': 'Gare SNCF <> 8 mai <> Tourny <> Gare SNCF',
};

function getManeuverIcon(maneuver) {
    switch(maneuver) {
        case 'TURN_LEFT': return ICONS.MANEUVER.TURN_LEFT;
        case 'TURN_RIGHT': return ICONS.MANEUVER.TURN_RIGHT;
        case 'TURN_SLIGHT_LEFT': return ICONS.MANEUVER.TURN_SLIGHT_LEFT;
        case 'TURN_SLIGHT_RIGHT': return ICONS.MANEUVER.TURN_SLIGHT_RIGHT;
        case 'ROUNDABOUT_LEFT': return ICONS.MANEUVER.ROUNDABOUT_LEFT;
        case 'ROUNDABOUT_RIGHT': return ICONS.MANEUVER.ROUNDABOUT_RIGHT;
        case 'STRAIGHT': return ICONS.MANEUVER.STRAIGHT;
        default: return ICONS.MANEUVER.DEFAULT;
    }
}

// ÉLÉMENTS DOM
let dashboardContainer, dashboardHall, dashboardContentView, btnBackToHall;
let infoTraficList, infoTraficAvenir, infoTraficCount;
let alertBanner, alertBannerContent, alertBannerClose;
let ficheHoraireContainer;
let searchBar, searchResultsContainer;
let mapContainer, btnShowMap, btnBackToDashboardFromMap;
let itineraryResultsContainer, btnBackToDashboardFromResults, resultsListContainer;
let resultsMap, resultsModeTabs;
let resultsFromInput, resultsToInput, resultsFromSuggestions, resultsToSuggestions;
let resultsSwapBtn, resultsWhenBtn, resultsPopover, resultsDate, resultsHour, resultsMinute;
let resultsPopoverSubmitBtn, resultsPlannerSubmitBtn, resultsGeolocateBtn;
let itineraryDetailContainer, btnBackToResults, detailMapHeader, detailMapSummary;
let detailPanelWrapper, detailPanelContent;
let hallPlannerSubmitBtn, hallFromInput, hallToInput, hallFromSuggestions, hallToSuggestions;
let hallWhenBtn, hallPopover, hallDate, hallHour, hallMinute, hallPopoverSubmitBtn, hallSwapBtn, hallGeolocateBtn;

let fromPlaceId = null;
let toPlaceId = null;

const LINE_CATEGORIES = {
    'majeures': { name: 'Lignes majeures', lines: ['A', 'B', 'C', 'D'], color: '#2563eb' },
    'express': { name: 'Lignes express', lines: ['e1', 'e2', 'e4', 'e5', 'e6', 'e7'], color: '#dc2626' },
    'quartier': { name: 'Lignes de quartier', lines: ['K1A', 'K1B', 'K2', 'K3A', 'K3B', 'K4A', 'K4B', 'K5', 'K6'], color: '#059669' },
    'rabattement': { name: 'Lignes de rabattement', lines: ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9', 'R10', 'R11', 'R12', 'R13', 'R14', 'R15'], color: '#7c3aed' },
    'navettes': { name: 'Navettes', lines: ['N', 'N1'], color: '#f59e0b' }
};

function getCategoryForRoute(routeShortName) {
    for (const [categoryId, category] of Object.entries(LINE_CATEGORIES)) {
        if (category.lines.includes(routeShortName)) {
            return categoryId;
        }
    }
    return 'autres';
}

async function initializeApp() {
    dashboardContainer = document.getElementById('dashboard-container');
    dashboardHall = document.getElementById('dashboard-hall');
    dashboardContentView = document.getElementById('dashboard-content-view');
    btnBackToHall = document.getElementById('btn-back-to-hall');
    infoTraficList = document.getElementById('info-trafic-list');
    infoTraficAvenir = document.getElementById('info-trafic-avenir');
    infoTraficCount = document.getElementById('info-trafic-count');
    alertBanner = document.getElementById('alert-banner');
    alertBannerContent = document.getElementById('alert-banner-content');
    alertBannerClose = document.getElementById('alert-banner-close');
    ficheHoraireContainer = document.getElementById('fiche-horaire-container');
    searchBar = document.getElementById('horaires-search-bar');
    searchResultsContainer = document.getElementById('horaires-search-results');
    mapContainer = document.getElementById('map-container');
    btnShowMap = document.getElementById('btn-show-map');
    btnBackToDashboardFromMap = document.getElementById('btn-back-to-dashboard-from-map');
    itineraryResultsContainer = document.getElementById('itinerary-results-container');
    btnBackToDashboardFromResults = document.getElementById('btn-back-to-dashboard-from-results');
    resultsListContainer = document.querySelector('#itinerary-results-container .results-list');
    resultsMap = document.getElementById('results-map'); 
    resultsModeTabs = document.getElementById('results-mode-tabs');
    resultsFromInput = document.getElementById('results-planner-from');
    resultsToInput = document.getElementById('results-planner-to');
    resultsFromSuggestions = document.getElementById('results-from-suggestions');
    resultsToSuggestions = document.getElementById('results-to-suggestions');
    resultsSwapBtn = document.getElementById('results-btn-swap-direction');
    resultsWhenBtn = document.getElementById('results-planner-when-btn');
    resultsPopover = document.getElementById('results-planner-options-popover');
    resultsDate = document.getElementById('results-popover-date');
    resultsHour = document.getElementById('results-popover-hour');
    resultsMinute = document.getElementById('results-popover-minute');
    resultsPopoverSubmitBtn = document.getElementById('results-popover-submit-btn');
    resultsPlannerSubmitBtn = document.getElementById('results-planner-submit-btn');
    resultsGeolocateBtn = document.getElementById('results-geolocate-btn');
    itineraryDetailContainer = document.getElementById('itinerary-detail-container');
    btnBackToResults = document.getElementById('btn-back-to-results');
    detailMapHeader = document.getElementById('detail-map-header');
    detailMapSummary = document.getElementById('detail-map-summary');
    detailPanelWrapper = document.getElementById('detail-panel-wrapper');
    detailPanelContent = document.getElementById('detail-panel-content');
    hallPlannerSubmitBtn = document.getElementById('planner-submit-btn');
    hallFromInput = document.getElementById('hall-planner-from');
    hallToInput = document.getElementById('hall-planner-to');
    hallFromSuggestions = document.getElementById('from-suggestions');
    hallToSuggestions = document.getElementById('to-suggestions');
    hallSwapBtn = document.getElementById('hall-btn-swap-direction');
    hallWhenBtn = document.getElementById('planner-when-btn');
    hallPopover = document.getElementById('planner-options-popover');
    hallDate = document.getElementById('popover-date');
    hallHour = document.getElementById('popover-hour');
    hallMinute = document.getElementById('popover-minute');
    hallPopoverSubmitBtn = document.getElementById('popover-submit-btn');
    hallGeolocateBtn = document.getElementById('hall-geolocate-btn');

    apiManager = new ApiManager(GOOGLE_API_KEY);
    dataManager = new DataManager();
    routerContext = createRouterContext({ dataManager, apiManager, icons: ICONS });

    setupStaticEventListeners();
    setupGeolocation();
    updateDataStatus('Chargement des données...', 'loading');

    try {
        await dataManager.loadAllData((message) => updateDataStatus(message, 'loading'));
        timeManager = new TimeManager();
        
        mapRenderer = new MapRenderer('map', dataManager, timeManager);
        mapRenderer.initializeMap();
        mapRenderer.addLocateControl(onGeolocationSuccess, onGeolocationError);

        detailMapRenderer = new MapRenderer('detail-map', dataManager, timeManager);
        detailMapRenderer.initializeMap(false);
        currentDetailMarkerLayer = L.layerGroup().addTo(detailMapRenderer.map);
        detailMapRenderer.addLocateControl(onGeolocationSuccess, onGeolocationError);
        
        resultsMapRenderer = new MapRenderer('results-map', dataManager, timeManager);
        resultsMapRenderer.initializeMap(false);
        currentResultsMarkerLayer = L.layerGroup().addTo(resultsMapRenderer.map);
        resultsMapRenderer.addLocateControl(onGeolocationSuccess, onGeolocationError);
        
        tripScheduler = new TripScheduler(dataManager);
        busPositionCalculator = new BusPositionCalculator(dataManager);
        
        initializeRouteFilter();
        
        if (dataManager.geoJson) {
            mapRenderer.displayMultiColorRoutes(dataManager.geoJson, dataManager, visibleRoutes);
        }

        mapRenderer.displayStops();
        setupDashboardContent(); 
        setupDataDependentEventListeners();

        if (localStorage.getItem('gtfsInstructionsShown') !== 'true') {
            document.getElementById('instructions').classList.add('hidden');
        }
        
        updateDataStatus('Données chargées', 'loaded');
        checkAndSetupTimeMode();
        updateData(); 
        
    } catch (error) {
        console.error('Erreur lors de l\'initialisation GTFS:', error);
        gtfsAvailable = false;
        updateDataStatus('GTFS indisponible. Mode dégradé (API seule).', 'warning');
    }

    // Attach robust handlers for back buttons and condensed nav (extra safety)
    try {
        attachRobustBackHandlers();
    } catch (e) { console.debug('attachRobustBackHandlers failed', e); }
}

function attachRobustBackHandlers() {
    const backIds = ['btn-back-to-hall', 'btn-back-to-dashboard-from-map', 'btn-back-to-dashboard-from-results'];
    backIds.forEach(id => {
        // fix duplicate ids: if multiple elements share the same id, rename extras
        const duplicates = Array.from(document.querySelectorAll(`#${id}`));
        if (duplicates.length > 1) {
            console.warn('attachRobustBackHandlers: duplicate id detected', id, duplicates.length);
            duplicates.forEach((el, idx) => {
                if (idx === 0) return; // keep first
                const newId = `${id}-dup-${idx}`;
                el.id = newId;
                console.warn('attachRobustBackHandlers: renamed duplicate id', id, '->', newId, el);
            });
        }

        const el = document.getElementById(id);
        if (!el) {
            console.debug('attachRobustBackHandlers: missing element', id);
            return;
        }
        // remove duplicate handlers if any
        try { el.removeEventListener('click', showDashboardHall); } catch (e) {}
        el.disabled = false;
        el.style.pointerEvents = 'auto';
        el.style.zIndex = el.style.zIndex || 2000;
        el.addEventListener('click', (ev) => {
            ev.preventDefault();
            console.debug('robust-back-click:', id);
            showDashboardHall();
        });
    });

    // Ensure condensed nav buttons are clickable
    document.querySelectorAll('.main-nav-buttons-condensed .nav-button-condensed[data-view]').forEach(btn => {
        btn.style.pointerEvents = 'auto';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const view = btn.dataset.view;
            console.debug('robust-nav-click', view);
            if (view) showDashboardView(view);
        });
    });

    // Temporary pointer diagnostics to help debug covered/blocked buttons.
    // Active for 25 seconds after initialization; logs element at pointer location.
    try {
        const DEBUG_DURATION_MS = 25000;
        const start = Date.now();
        const pd = (ev) => {
            try {
                if ((Date.now() - start) > DEBUG_DURATION_MS) {
                    document.removeEventListener('pointerdown', pd, true);
                    return;
                }
                const x = ev.clientX, y = ev.clientY;
                const elAt = document.elementFromPoint(x, y);
                console.debug('pointerdown-debug', { x, y, target: ev.target && ev.target.id, elementAtPoint: elAt && (elAt.id || elAt.className || elAt.tagName) });
            } catch (err) { /* ignore */ }
        };
        document.addEventListener('pointerdown', pd, true);
        console.info('Back-button pointer diagnostics active for 25s. Click the problematic area and check console for `pointerdown-debug`.');
    } catch (e) { /* ignore */ }
}

function setupDashboardContent() {
    dataManager.routes.forEach(route => {
        lineStatuses[route.route_id] = { status: 'normal', message: '' };
    });
    renderInfoTraficCard();
    buildFicheHoraireList();
}

// Fonction d'animation générique (DÉPLACÉE EN DEHORS)
function animateValue(obj, start, end, duration, suffix = "") {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        
        // Easing function (pour que ça ralentisse à la fin)
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        
        const value = Math.floor(easeOutQuart * (end - start) + start);
        
        // Gestion spéciale pour les nombres à virgule (comme 2.1M)
        if (suffix === "M" && end === 2.1) {
             obj.innerHTML = (easeOutQuart * 2.1).toFixed(1) + suffix;
        } else {
             obj.innerHTML = value + suffix;
        }

        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
             // S'assurer que la valeur finale est exacte
             obj.innerHTML = end + suffix;
        }
    };
    window.requestAnimationFrame(step);
}

function populateTimeSelects() {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = Math.round(now.getMinutes() / 5) * 5; 
    let selectedHour = currentHour;
    let selectedMinute = currentMinute;
    if (currentMinute === 60) {
        selectedMinute = 0;
        selectedHour = (currentHour + 1) % 24; 
    }

    const MAX_DAY_OFFSET = 7; // toujours proposer une semaine complète
    const formatDateLabel = (dateObj, offset) => {
        if (offset === 0) return "Aujourd'hui";
        if (offset === 1) return "Demain";
        return dateObj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    };

    const populate = (dateEl, hourEl, minEl) => {
        if (!dateEl || !hourEl || !minEl) return;
        dateEl.innerHTML = '';
        for (let offset = 0; offset <= MAX_DAY_OFFSET; offset++) {
            const dateObj = new Date(now);
            dateObj.setDate(now.getDate() + offset);
            const isoValue = dateObj.toISOString().split('T')[0];
            const option = document.createElement('option');
            option.value = isoValue;
            option.textContent = formatDateLabel(dateObj, offset);
            if (offset === 0) option.selected = true;
            dateEl.appendChild(option);
        }

        hourEl.innerHTML = '';
        for (let h = 0; h < 24; h++) {
            const option = document.createElement('option');
            option.value = h;
            option.textContent = `${h} h`;
            if (h === selectedHour) option.selected = true;
            hourEl.appendChild(option);
        }

        minEl.innerHTML = '';
        for (let m = 0; m < 60; m += 5) {
            const option = document.createElement('option');
            option.value = m;
            option.textContent = String(m).padStart(2, '0');
            if (m === selectedMinute) option.selected = true;
            minEl.appendChild(option);
        }
    };

    populate(hallDate, hallHour, hallMinute);
    populate(resultsDate, resultsHour, resultsMinute);
}

// ✅ V58: Helper pour calculer la distance en mètres
function getDistanceFromLatLonInM(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Rayon de la terre en mètres
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function setupGeolocation() {
    hallGeolocateBtn.innerHTML = ICONS.GEOLOCATE;
    resultsGeolocateBtn.innerHTML = ICONS.GEOLOCATE;
    if (!navigator.geolocation) {
        console.warn("La géolocalisation n'est pas supportée par ce navigateur.");
        return;
    }
    navigator.geolocation.watchPosition(onGeolocationSuccess, onGeolocationError, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

/**
 * ✅ V58: Version optimisée avec Debounce et Throttling
 */
function onGeolocationSuccess(position) {
    const newLat = position.coords.latitude;
    const newLng = position.coords.longitude;

    // 1. Debounce VISUEL : Si on a bougé de moins de 10 mètres, on ignore
    if (userLocation) {
        const dist = getDistanceFromLatLonInM(userLocation.lat, userLocation.lng, newLat, newLng);
        if (dist < 10) return; 
    }

    // Mise à jour de la position stockée
    userLocation = { lat: newLat, lng: newLng };

    // Mise à jour des marqueurs "point bleu"
    if (mapRenderer) mapRenderer.updateUserLocation(userLocation);
    if (resultsMapRenderer) resultsMapRenderer.updateUserLocation(userLocation);
    if (detailMapRenderer) detailMapRenderer.updateUserLocation(userLocation);

    // Activer les boutons du formulaire
    hallGeolocateBtn.disabled = false;
    resultsGeolocateBtn.disabled = false;

    // 2. Throttling API : Appel Reverse Geocode intelligent
    const now = Date.now();
    const MIN_TIME_BETWEEN_CALLS = 60000; // 60 secondes
    const MIN_DIST_BETWEEN_CALLS = 200;   // 200 mètres

    let shouldCallApi = false;

    if (!lastGeocodeTime) {
        // Premier appel : Oui
        shouldCallApi = true;
    } else if (userPlaceId === null && !isGeocoding) {
        // On a raté le dernier appel ou pas d'adresse : Oui
        shouldCallApi = true;
    } else {
        // Vérifier le temps
        const timeElapsed = now - lastGeocodeTime;
        // Vérifier la distance depuis le dernier appel API
        let distFromLastCall = 0;
        if (lastGeocodePos) {
            distFromLastCall = getDistanceFromLatLonInM(lastGeocodePos.lat, lastGeocodePos.lng, newLat, newLng);
        }

        if (timeElapsed > MIN_TIME_BETWEEN_CALLS || distFromLastCall > MIN_DIST_BETWEEN_CALLS) {
            shouldCallApi = true;
        }
    }

    if (shouldCallApi && !isGeocoding) {
        reverseGeocodeUserLocation(newLat, newLng);
        lastGeocodeTime = now;
        lastGeocodePos = { lat: newLat, lng: newLng };
    }
}

function onGeolocationError(error) {
    console.warn(`Erreur de géolocalisation (code ${error.code}): ${error.message}`);
    hallGeolocateBtn.disabled = true;
    resultsGeolocateBtn.disabled = true;
    if (mapRenderer) mapRenderer.onLocateError();
    if (resultsMapRenderer) resultsMapRenderer.onLocateError();
    if (detailMapRenderer) detailMapRenderer.onLocateError();
}

async function reverseGeocodeUserLocation(lat, lng) {
    if (isGeocoding) return; 
    isGeocoding = true;
    try {
        const placeId = await apiManager.reverseGeocode(lat, lng);
        if (placeId) {
            userPlaceId = placeId;
            console.log("Géolocalisation inversée réussie, place_id:", userPlaceId);
        } else {
            userPlaceId = null;
        }
    } catch (error) {
        console.error("Erreur lors de la géolocalisation inversée:", error);
        userPlaceId = null;
    } finally {
        isGeocoding = false;
    }
}

async function useCurrentLocationAsDeparture(source, elements) {
    const { fromInput, toInput, geolocateBtn } = elements;

    if (!userLocation) {
        alert("Impossible de récupérer votre position. Avez-vous autorisé la géolocalisation ?");
        return;
    }

    geolocateBtn.innerHTML = ICONS.GEOLOCATE_SPINNER;
    geolocateBtn.disabled = true;

    if (!userPlaceId || isGeocoding) {
        console.log("Attente du reverse geocoding...");
        await new Promise(resolve => {
            const checkGeocoding = setInterval(() => {
                if (!isGeocoding) {
                    clearInterval(checkGeocoding);
                    resolve();
                }
            }, 100);
        });
    }
    
    if (!userPlaceId) {
        alert("Impossible de convertir votre position en adresse pour le planificateur. Veuillez réessayer.");
        geolocateBtn.innerHTML = ICONS.GEOLOCATE;
        geolocateBtn.disabled = false;
        return;
    }

    fromPlaceId = userPlaceId;
    fromInput.value = "Ma Position";
    toInput.focus();
    geolocateBtn.innerHTML = ICONS.GEOLOCATE;
    geolocateBtn.disabled = false;
}

function setupStaticEventListeners() {
    try { apiManager.loadGoogleMapsAPI(); } catch (error) { console.error("Impossible de charger l'API Google:", error); }
    populateTimeSelects();

    document.querySelectorAll('.main-nav-buttons-condensed .nav-button-condensed[data-view]').forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const view = button.dataset.view;
            showDashboardView(view);
        });
    });

    btnShowMap.addEventListener('click', showMapView); 
    btnBackToDashboardFromMap.addEventListener('click', showDashboardHall);
    btnBackToDashboardFromResults.addEventListener('click', showDashboardHall); 
    btnBackToHall.addEventListener('click', showDashboardHall);
    btnBackToResults.addEventListener('click', hideDetailView);

    let touchStartY = 0;
    detailPanelWrapper.addEventListener('touchstart', (e) => { touchStartY = e.touches[0].clientY; }, { passive: true }); 
    detailPanelWrapper.addEventListener('touchmove', (e) => {
        const currentTouchY = e.touches[0].clientY;
        const currentScrollTop = detailPanelWrapper.scrollTop;
        const deltaY = currentTouchY - touchStartY;
        if (currentScrollTop === 0 && deltaY > 0 && itineraryDetailContainer.classList.contains('is-scrolled')) {
            e.preventDefault(); 
            itineraryDetailContainer.classList.remove('is-scrolled');
        }
        if (deltaY < 0 && !itineraryDetailContainer.classList.contains('is-scrolled')) {
            itineraryDetailContainer.classList.add('is-scrolled');
        }
    }, { passive: false }); 
    detailPanelWrapper.addEventListener('scroll', () => {
        const currentScrollTop = detailPanelWrapper.scrollTop;
        if (currentScrollTop > 10 && !itineraryDetailContainer.classList.contains('is-scrolled')) {
            itineraryDetailContainer.classList.add('is-scrolled');
        }
    });

    alertBannerClose.addEventListener('click', () => alertBanner.classList.add('hidden'));
    
    document.querySelectorAll('.tabs .tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const tabContent = tab.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.toggle('hidden', content.dataset.content !== tabContent);
            });
        });
    });

    document.getElementById('close-instructions').addEventListener('click', () => {
        document.getElementById('instructions').classList.add('hidden');
        localStorage.setItem('gtfsInstructionsShown', 'true');
    });
    document.getElementById('btn-toggle-filter').addEventListener('click', () => {
        document.getElementById('route-filter-panel').classList.toggle('hidden');
    });
    document.getElementById('close-filter').addEventListener('click', () => {
        document.getElementById('route-filter-panel').classList.add('hidden');
    });
    const panelHandle = document.querySelector('#route-filter-panel .panel-handle');
    if (panelHandle) {
        panelHandle.addEventListener('click', () => {
            document.getElementById('route-filter-panel').classList.add('hidden');
        });
    }
    document.getElementById('select-all-routes').addEventListener('click', () => {
        if (dataManager) {
            dataManager.routes.forEach(route => {
                const checkbox = document.getElementById(`route-${route.route_id}`);
                if (checkbox) checkbox.checked = true;
            });
            handleRouteFilterChange();
        }
    });
    document.getElementById('deselect-all-routes').addEventListener('click', () => {
        if (dataManager) {
            dataManager.routes.forEach(route => {
                const checkbox = document.getElementById(`route-${route.route_id}`);
                if (checkbox) checkbox.checked = false;
            });
            handleRouteFilterChange();
        }
    });

    document.getElementById('btn-horaires-search-focus').addEventListener('click', () => {
        const horairesCard = document.getElementById('horaires');
        if (horairesCard) {
            window.scrollTo({ top: horairesCard.offsetTop - 80, behavior: 'smooth' });
        }
        searchBar.focus();
    });
    searchBar.addEventListener('input', handleSearchInput);
    searchBar.addEventListener('focus', handleSearchInput);

    setupPlannerListeners('hall', {
        submitBtn: hallPlannerSubmitBtn,
        fromInput: hallFromInput,
        toInput: hallToInput,
        fromSuggestions: hallFromSuggestions,
        toSuggestions: hallToSuggestions,
        swapBtn: hallSwapBtn,
        whenBtn: hallWhenBtn,
        popover: hallPopover,
        dateSelect: hallDate,
        hourSelect: hallHour,
        minuteSelect: hallMinute,
        popoverSubmitBtn: hallPopoverSubmitBtn,
        geolocateBtn: hallGeolocateBtn
    });

    setupPlannerListeners('results', {
        submitBtn: resultsPlannerSubmitBtn,
        fromInput: resultsFromInput,
        toInput: resultsToInput,
        fromSuggestions: resultsFromSuggestions,
        toSuggestions: resultsToSuggestions,
        swapBtn: resultsSwapBtn,
        whenBtn: resultsWhenBtn,
        popover: resultsPopover,
        dateSelect: resultsDate,
        hourSelect: resultsHour,
        minuteSelect: resultsMinute,
        popoverSubmitBtn: resultsPopoverSubmitBtn,
        geolocateBtn: resultsGeolocateBtn
    });

    document.addEventListener('click', (e) => {
        if (searchResultsContainer && !e.target.closest('#horaires-search-container')) {
            searchResultsContainer.classList.add('hidden');
        }
        if (hallPopover && !e.target.closest('#hall-planner-from') && !e.target.closest('#hall-planner-to') && !e.target.closest('.form-group-when')) {
            if (!hallPopover.classList.contains('hidden')) {
                hallPopover.classList.add('hidden');
                hallWhenBtn.classList.remove('popover-active');
            }
        }
        if (resultsPopover && !e.target.closest('#results-planner-from') && !e.target.closest('#results-planner-to') && !e.target.closest('.form-group-when')) {
            if (!resultsPopover.classList.contains('hidden')) {
                resultsPopover.classList.add('hidden');
                resultsWhenBtn.classList.remove('popover-active');
            }
        }
        if (!e.target.closest('.form-group')) {
            if (hallFromSuggestions) hallFromSuggestions.style.display = 'none';
            if (hallToSuggestions) hallToSuggestions.style.display = 'none';
            if (resultsFromSuggestions) resultsFromSuggestions.style.display = 'none';
            if (resultsToSuggestions) resultsToSuggestions.style.display = 'none';
        }
    });
}

function setupDataDependentEventListeners() {
    if (timeManager) {
        timeManager.addListener(updateData);
    }
    if (mapRenderer && mapRenderer.map) {
        mapRenderer.map.on('zoomend', () => {
            if (dataManager) {
                mapRenderer.displayStops();
            }
        });
    }
}

function setupPlannerListeners(source, elements) {
    const { submitBtn, fromInput, toInput, fromSuggestions, toSuggestions, swapBtn, whenBtn, popover, dateSelect, hourSelect, minuteSelect, popoverSubmitBtn, geolocateBtn } = elements;
    
    // Drapeau pour savoir si l'utilisateur a manuellement modifié la date/heure
    let userAdjustedTime = false;

    // Si l'utilisateur change un select, on marque qu'il a ajusté le temps
    try {
        if (dateSelect) dateSelect.addEventListener('change', () => { userAdjustedTime = true; });
        if (hourSelect) hourSelect.addEventListener('change', () => { userAdjustedTime = true; });
        if (minuteSelect) minuteSelect.addEventListener('change', () => { userAdjustedTime = true; });
    } catch (e) {
        // Certains éléments peuvent être undefined dans certains contextes; on ignore
    }
    submitBtn.addEventListener('click', async (e) => {
        e.preventDefault(); 
        if (popover && !popover.classList.contains('hidden')) {
            popover.classList.add('hidden');
            whenBtn.classList.remove('popover-active');
        }
        await executeItinerarySearch(source, elements);
    });

    fromInput.addEventListener('input', (e) => {
        handleAutocomplete(e.target.value, fromSuggestions, (placeId) => {
            fromPlaceId = placeId; 
        });
    });

    toInput.addEventListener('input', (e) => {
        handleAutocomplete(e.target.value, toSuggestions, (placeId) => {
            toPlaceId = placeId; 
        });
    });

    if (whenBtn && popover) { 
        whenBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            popover.classList.toggle('hidden');
            whenBtn.classList.toggle('popover-active');
            // Réinitialiser le drapeau à l'ouverture du popover
            userAdjustedTime = false;
        });
        popover.querySelectorAll('.popover-tab').forEach(tab => { 
            tab.addEventListener('click', (e) => {
                popover.querySelectorAll('.popover-tab').forEach(t => t.classList.remove('active'));
                e.currentTarget.classList.add('active');
                const tabType = e.currentTarget.dataset.tab;
                popoverSubmitBtn.textContent = (tabType === 'arriver') ? "Valider l'arrivée" : 'Partir maintenant';
            });
        });
        popoverSubmitBtn.addEventListener('click', () => { 
             const dateText = dateSelect.options[dateSelect.selectedIndex].text;
             const tab = popover.querySelector('.popover-tab.active').dataset.tab;

             // Si l'utilisateur choisit "partir" ET n'a PAS modifié manuellement la date/heure,
             // forcer la sélection de la date et de l'heure courantes.
             if (tab === 'partir' && !userAdjustedTime) {
                 const now = new Date();
                 const todayValue = now.toISOString().split('T')[0];
                 let currentHour = now.getHours();
                 let currentMinute = Math.round(now.getMinutes() / 5) * 5;
                 if (currentMinute === 60) {
                     currentMinute = 0;
                     currentHour = (currentHour + 1) % 24;
                 }
                 try {
                     dateSelect.value = todayValue;
                     hourSelect.value = currentHour;
                     minuteSelect.value = currentMinute;
                 } catch (e) {}
             }

             const hourText = String(hourSelect.value).padStart(2, '0');
             const minuteText = String(minuteSelect.value).padStart(2, '0');
             const mainBtnSpan = whenBtn.querySelector('span');
             let prefix = (tab === 'arriver') ? "Arrivée" : "Départ";
             if (dateText === "Aujourd'hui") {
                 mainBtnSpan.textContent = `${prefix} à ${hourText}h${minuteText}`;
             } else {
                 mainBtnSpan.textContent = `${prefix} ${dateText.toLowerCase()} à ${hourText}h${minuteText}`;
             }
             popover.classList.add('hidden');
             whenBtn.classList.remove('popover-active');
        });
        popover.addEventListener('click', (e) => e.stopPropagation()); 
    }
    
    if (swapBtn) {
        swapBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const fromVal = fromInput.value;
            fromInput.value = toInput.value;
            toInput.value = fromVal;
            const tempId = fromPlaceId;
            fromPlaceId = toPlaceId;
            toPlaceId = tempId;
        });
    }

    if (geolocateBtn) {
        geolocateBtn.addEventListener('click', (e) => {
            e.preventDefault();
            useCurrentLocationAsDeparture(source, elements);
        });
    }
}

async function executeItinerarySearch(source, sourceElements) {
    const { fromInput, toInput, dateSelect, hourSelect, minuteSelect, popover } = sourceElements;
    if (!fromPlaceId || !toPlaceId) {
        alert("Veuillez sélectionner un point de départ et d'arrivée depuis les suggestions.");
        return;
    }
    const searchTime = {
        type: popover.querySelector('.popover-tab.active').dataset.tab, 
        date: dateSelect.value,
        hour: hourSelect.value,
        minute: minuteSelect.value
    };
    prefillOtherPlanner(source, sourceElements);
    console.log(`Recherche Google API (source: ${source}):`, { from: fromPlaceId, to: toPlaceId, time: searchTime });
    if (source === 'hall') {
        showResultsView(); 
    } else {
        resultsListContainer.innerHTML = '<p class="results-message">Mise à jour de l\'itinéraire...</p>';
    }
    resultsModeTabs.classList.add('hidden');
    allFetchedItineraries = [];
    try {
        let fromCoords = null;
        let toCoords = null;
        try {
            fromCoords = await apiManager.getPlaceCoords(fromPlaceId);
        } catch (e) {
            console.warn('Impossible de récupérer les coordonnées départ (place_id):', e);
        }
        try {
            toCoords = await apiManager.getPlaceCoords(toPlaceId);
        } catch (e) {
            console.warn('Impossible de récupérer les coordonnées arrivée (place_id):', e);
        }

        const fromLabel = sourceElements.fromInput?.value || '';
        const toLabel = sourceElements.toInput?.value || '';

        let hybridItins = [];
        const canUseHybridRouting = dataManager && dataManager.isLoaded && gtfsAvailable && routerContext;
        if (canUseHybridRouting) {
            try {
                hybridItins = await routerContext.computeHybridItinerary(fromCoords, toCoords, searchTime, { fromLabel, toLabel });
            } catch (e) {
                console.warn('Erreur lors de la construction hybride :', e);
            }
        }

        if (hybridItins && hybridItins.length) {
            allFetchedItineraries = hybridItins;
        } else {
            console.log('🆘 Aucun trajet GTFS local, fallback Google Transit en cours...');
            const intelligentResults = await apiManager.fetchItinerary(fromPlaceId, toPlaceId, searchTime); 
            allFetchedItineraries = processIntelligentResults(intelligentResults, searchTime);
        }
        // Ensure every BUS step has a polyline (GTFS constructed or fallback)
        try {
            await ensureItineraryPolylines(allFetchedItineraries);
        } catch (e) {
            console.warn('Erreur lors de l\'assurance des polylines:', e);
        }

        setupResultTabs(allFetchedItineraries);
        renderItineraryResults('ALL');
        if (allFetchedItineraries.length > 0) {
            drawRouteOnResultsMap(allFetchedItineraries[0]);
        }
    } catch (error) {
        console.error("Échec de la recherche d'itinéraire:", error);
        if (resultsListContainer) {
            resultsListContainer.innerHTML = `<p class="results-message error">Impossible de calculer l'itinéraire. ${error.message}</p>`;
        }
        resultsModeTabs.classList.add('hidden');
    }
}

function prefillOtherPlanner(sourceFormName, sourceElements) {
    let targetElements;
    if (sourceFormName === 'hall') {
        targetElements = {
            fromInput: resultsFromInput, toInput: resultsToInput,
            dateSelect: resultsDate, hourSelect: resultsHour, minuteSelect: resultsMinute,
            whenBtn: resultsWhenBtn, popover: resultsPopover, popoverSubmitBtn: resultsPopoverSubmitBtn
        };
    } else {
        targetElements = {
            fromInput: hallFromInput, toInput: hallToInput,
            dateSelect: hallDate, hourSelect: hallHour, minuteSelect: hallMinute,
            whenBtn: hallWhenBtn, popover: hallPopover, popoverSubmitBtn: hallPopoverSubmitBtn
        };
    }
    targetElements.fromInput.value = sourceElements.fromInput.value;
    targetElements.toInput.value = sourceElements.toInput.value;
    targetElements.dateSelect.value = sourceElements.dateSelect.value;
    targetElements.hourSelect.value = sourceElements.hourSelect.value;
    targetElements.minuteSelect.value = sourceElements.minuteSelect.value;
    const sourceActiveTab = sourceElements.popover.querySelector('.popover-tab.active').dataset.tab;
    targetElements.popover.querySelectorAll('.popover-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === sourceActiveTab);
    });
    targetElements.whenBtn.querySelector('span').textContent = sourceElements.whenBtn.querySelector('span').textContent;
    targetElements.popoverSubmitBtn.textContent = (sourceActiveTab === 'arriver') ? "Valider l'arrivée" : 'Partir maintenant';
}

async function handleAutocomplete(query, container, onSelect) {
    if (query.length < 3) {
        container.innerHTML = '';
        container.style.display = 'none';
        onSelect(null); 
        return;
    }
    try {
        const suggestions = await apiManager.getPlaceAutocomplete(query);
        renderSuggestions(suggestions, container, onSelect);
    } catch (error) {
        console.warn("Erreur d'autocomplétion:", error);
        container.style.display = 'none';
    }
}

function renderSuggestions(suggestions, container, onSelect) {
    container.innerHTML = '';
    if (suggestions.length === 0) {
        container.style.display = 'none';
        return;
    }
    suggestions.forEach(suggestion => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        const mainText = suggestion.description.split(',')[0];
        const secondaryText = suggestion.description.substring(mainText.length);
        item.innerHTML = `<strong>${mainText}</strong>${secondaryText}`;
        item.addEventListener('click', () => {
            const inputElement = container.previousElementSibling; 
            inputElement.value = suggestion.description; 
            onSelect(suggestion.placeId); 
            container.innerHTML = ''; 
            container.style.display = 'none';
        });
        container.appendChild(item);
    });
    container.style.display = 'block';
}

function processGoogleRoutesResponse(data) {
    if (!data || !data.routes || data.routes.length === 0) {
        console.warn("Réponse de l'API Routes (BUS) vide ou invalide.");
        return [];
    }
    return data.routes.map(route => {
        const leg = route.legs[0];
        let isRegionalRoute = false; 
        const itinerary = {
            type: 'BUS', 
            priority: 1, 
            departureTime: "--:--", 
            arrivalTime: "--:--",
            duration: formatGoogleDuration(route.duration),
            durationRaw: parseGoogleDuration(route.duration), 
            polyline: route.polyline,
            summarySegments: [], 
            steps: []
        };
        let currentWalkStep = null;

        for (const step of leg.steps) {
            const duration = formatGoogleDuration(step.staticDuration);
            const rawDuration = parseGoogleDuration(step.staticDuration);
            const distanceMeters = step.distanceMeters || 0;
            const distanceText = step.localizedValues?.distance?.text || '';
            const instruction = step.navigationInstruction?.instructions || step.localizedValues?.instruction || "Marcher";
            const maneuver = step.navigationInstruction?.maneuver || 'DEFAULT';

            if (step.travelMode === 'WALK') {
                if (!currentWalkStep) {
                    currentWalkStep = {
                        type: 'WALK', icon: ICONS.WALK, instruction: "Marche",
                        subSteps: [], polylines: [], totalDuration: 0, totalDistanceMeters: 0,
                        departureTime: "--:--", arrivalTime: "--:--"
                    };
                }
                currentWalkStep.subSteps.push({ instruction, distance: distanceText, duration, maneuver });
                currentWalkStep.polylines.push(step.polyline);
                currentWalkStep.totalDuration += rawDuration;
                currentWalkStep.totalDistanceMeters += distanceMeters;

            } else if (step.travelMode === 'TRANSIT' && step.transitDetails) {
                const transit = step.transitDetails;
                const stopDetails = transit.stopDetails || {};

                if (currentWalkStep) {
                    currentWalkStep.duration = formatGoogleDuration(currentWalkStep.totalDuration + 's');
                    if (currentWalkStep.totalDistanceMeters > 1000) {
                        currentWalkStep.distance = `${(currentWalkStep.totalDistanceMeters / 1000).toFixed(1)} km`;
                    } else {
                        currentWalkStep.distance = `${currentWalkStep.totalDistanceMeters} m`;
                    }
                    const nextDepTime = transit.localizedValues?.departureTime?.time?.text || formatGoogleTime(stopDetails.departureTime);
                    currentWalkStep.arrivalTime = nextDepTime;
                    itinerary.steps.push(currentWalkStep);
                    currentWalkStep = null;
                }
                
                const line = transit.transitLine;
                if (line) {
                    const shortName = line.nameShort || 'BUS';
                    if (dataManager && dataManager.isLoaded && !dataManager.routesByShortName[shortName]) {
                        console.warn(`[Filtre] Trajet rejeté: Ligne non-locale ("${shortName}") détectée.`);
                        isRegionalRoute = true;
                    }
                    const color = line.color || '#3388ff';
                    const textColor = line.textColor || '#ffffff';
                    const departureStop = stopDetails.departureStop || {};
                    const arrivalStop = stopDetails.arrivalStop || {};
                    let intermediateStops = (stopDetails.intermediateStops || []).map(stop => stop.name || 'Arrêt inconnu');
                    
                    if (intermediateStops.length === 0 && dataManager && dataManager.isLoaded) {
                        const apiDepName = departureStop.name;
                        const apiArrName = arrivalStop.name;
                        const apiHeadsign = transit.headsign;
                        if (apiDepName && apiArrName && apiHeadsign) {
                            const gtfsStops = dataManager.getIntermediateStops(shortName, apiHeadsign, apiDepName, apiArrName);
                            if (gtfsStops && gtfsStops.length > 0) {
                                intermediateStops = gtfsStops;
                            }
                        }
                    }
                    const depTime = transit.localizedValues?.departureTime?.time?.text || formatGoogleTime(stopDetails.departureTime);
                    const arrTime = transit.localizedValues?.arrivalTime?.time?.text || formatGoogleTime(stopDetails.arrivalTime);
                    itinerary.steps.push({
                        type: 'BUS', icon: ICONS.BUS, routeShortName: shortName, routeColor: color, routeTextColor: textColor,
                        instruction: `Prendre le <b>${shortName}</b> direction <b>${transit.headsign || 'destination'}</b>`,
                        departureStop: departureStop.name || 'Arrêt de départ', departureTime: depTime,
                        arrivalStop: arrivalStop.name || 'Arrêt d\'arrivée', arrivalTime: arrTime,
                        numStops: transit.stopCount || 0, intermediateStops: intermediateStops,
                        duration: formatGoogleDuration(step.staticDuration), polyline: step.polyline
                    });
                }
            }
        }
        
        if (isRegionalRoute) return null;

        if (currentWalkStep) {
            currentWalkStep.duration = formatGoogleDuration(currentWalkStep.totalDuration + 's');
            if (currentWalkStep.totalDistanceMeters > 1000) {
                currentWalkStep.distance = `${(currentWalkStep.totalDistanceMeters / 1000).toFixed(1)} km`;
            } else {
                currentWalkStep.distance = `${currentWalkStep.totalDistanceMeters} m`;
            }
            const legArrivalTime = leg.localizedValues?.arrivalTime?.time?.text || "--:--";
            currentWalkStep.arrivalTime = legArrivalTime;
            itinerary.steps.push(currentWalkStep);
        }
        
        if (itinerary.steps.length > 0) {
            const firstStepWithTime = itinerary.steps.find(s => s.departureTime && s.departureTime !== "--:--");
            itinerary.departureTime = firstStepWithTime ? firstStepWithTime.departureTime : (itinerary.steps[0].departureTime || "--:--");
            const lastStepWithTime = [...itinerary.steps].reverse().find(s => s.arrivalTime && s.arrivalTime !== "--:--");
            itinerary.arrivalTime = lastStepWithTime ? lastStepWithTime.arrivalTime : (itinerary.steps[itinerary.steps.length - 1].arrivalTime || "--:--");
        }
                
        const allSummarySegments = itinerary.steps.map(step => {
            if (step.type === 'WALK') {
                return { type: 'WALK', duration: step.duration };
            } else {
                return { type: 'BUS', name: step.routeShortName, color: step.routeColor, textColor: step.routeTextColor, duration: step.duration };
            }
        });
        itinerary.summarySegments = allSummarySegments.filter(segment => segment.type === 'BUS');
        return itinerary;
    }).filter(itinerary => itinerary !== null);
}

function processIntelligentResults(intelligentResults, searchTime) {
    console.log("=== DÉBUT PROCESS INTELLIGENT RESULTS ===");
    const itineraries = [];
    const sortedRecommendations = [...intelligentResults.recommendations].sort((a, b) => b.score - a.score);

    // 1. Extraction des résultats Google
    sortedRecommendations.forEach(rec => {
        let modeData = null;
        let modeInfo = null;
        if (rec.mode === 'bus' && intelligentResults.bus) {
            modeData = intelligentResults.bus.data;
            modeInfo = intelligentResults.bus;
        } else if (rec.mode === 'bike' && intelligentResults.bike) {
            modeData = intelligentResults.bike.data;
            modeInfo = intelligentResults.bike;
        } else if (rec.mode === 'walk' && intelligentResults.walk) {
            modeData = intelligentResults.walk.data;
            modeInfo = intelligentResults.walk;
        }

        if (modeData && modeInfo) {
            if (rec.mode === 'bus') {
                const busItineraries = processGoogleRoutesResponse(modeData);
                if (busItineraries.length > 0) {
                    busItineraries.forEach((itin, index) => {
                        itin.score = rec.score - index;
                        if (!itin.type) itin.type = 'BUS';
                    });
                }
                itineraries.push(...busItineraries);
            } else {
                const simpleItinerary = processSimpleRoute(modeData, rec.mode, modeInfo, searchTime);
                if (simpleItinerary) {
                    simpleItinerary.score = rec.score;
                    if (rec.mode === 'bike' && simpleItinerary.type !== 'BIKE') simpleItinerary.type = 'BIKE';
                    if (rec.mode === 'walk' && simpleItinerary.type !== 'WALK') simpleItinerary.type = 'WALK';
                    itineraries.push(simpleItinerary);
                }
            }
        }
    });

    // 2. LOGIQUE DE FENÊTRE TEMPORELLE (Horaire Arrivée)
    try {
        if (searchTime && searchTime.type === 'arriver') {
            // A. Définir la cible
            let reqDate = null;
            if (!searchTime.date || searchTime.date === 'today' || searchTime.date === "Aujourd'hui") {
                reqDate = new Date();
            } else {
                reqDate = new Date(searchTime.date);
            }
            const reqHour = parseInt(searchTime.hour) || 0;
            const reqMinute = parseInt(searchTime.minute) || 0;
            reqDate.setHours(reqHour, reqMinute, 0, 0);
            const reqMs = reqDate.getTime();

            // B. Définir la Marge ASYMÉTRIQUE : 45 minutes AVANT, 30 minutes APRÈS (config demandée)
            const BEFORE_MINUTES = 45; // avant l'heure demandée
            const AFTER_MINUTES = 30;  // après l'heure demandée
            const windowStart = reqMs - BEFORE_MINUTES * 60 * 1000;
            const windowEnd = reqMs + AFTER_MINUTES * 60 * 1000;

            console.log(`🕒 Cible: ${reqDate.toLocaleTimeString()} | Fenêtre: ${new Date(windowStart).toLocaleTimeString()} → ${new Date(windowEnd).toLocaleTimeString()} ( -${BEFORE_MINUTES}min / +${AFTER_MINUTES}min )`);

            const busItins = itineraries.filter(i => i.type === 'BUS' && i.arrivalTime && i.arrivalTime !== '~' && i.arrivalTime !== '--:--');
            const otherItins = itineraries.filter(i => i.type !== 'BUS');

            // Parser l'heure d'arrivée (HH:MM) en Timestamp
            const parseArrivalMs = (arrivalStr) => {
                if (!arrivalStr || typeof arrivalStr !== 'string') return NaN;
                const m = arrivalStr.match(/(\d{1,2}):(\d{2})/);
                if (!m) return NaN;
                const hh = parseInt(m[1], 10);
                const mm = parseInt(m[2], 10);
                const d = new Date(reqDate);
                d.setHours(hh, mm, 0, 0);
                return d.getTime();
            };

            const busWithMs = busItins.map(i => ({ itin: i, arrivalMs: parseArrivalMs(i.arrivalTime) })).filter(x => !isNaN(x.arrivalMs));

            // C. Filtrer les bus Google qui sont DANS la fenêtre
            let filteredBus = busWithMs
                .filter(x => x.arrivalMs >= windowStart && x.arrivalMs <= windowEnd)
                .map(x => x.itin);

            console.log(`🚌 Bus Google trouvés dans la fenêtre : ${filteredBus.length}`);

            // D. INJECTION GTFS (Data locale) pour compléter
            // ON SUPPRIME LA LIMITE "TARGET_BUS_COUNT" pour prendre TOUT ce qui existe.
            
            let gtfsAdded = [];
            let candidateStopIds = new Set();
            if (dataManager && dataManager.isLoaded) {
                console.log("📂 Recherche dans les données GTFS locales...");
                
                const normalize = (name) => {
                    if (!name) return "";
                    return name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '').trim();
                };

                // Récupérer les noms d'arrêts d'arrivée depuis Google pour savoir où chercher
                const candidateNames = new Set();
                busItins.forEach(it => {
                    if (!it.steps) return;
                    const lastBusStep = [...it.steps].reverse().find(s => s.type === 'BUS');
                    if (lastBusStep && lastBusStep.arrivalStop) candidateNames.add(lastBusStep.arrivalStop);
                });

                candidateStopIds = new Set();
                candidateNames.forEach(n => {
                    const key = normalize(n);
                    if (dataManager.stopsByName && dataManager.stopsByName[key]) {
                        dataManager.stopsByName[key].forEach(s => candidateStopIds.add(s.stop_id));
                    } else {
                        // Fallback recherche large
                        dataManager.stops.forEach(s => {
                            if (normalize(s.stop_name || '').includes(key)) candidateStopIds.add(s.stop_id);
                        });
                    }
                });
                
                // Si Google n'a rien donné, on cherche "Tourny" ou "Gare" par défaut (optionnel)
                if (candidateStopIds.size === 0) {
                     console.warn("⚠️ Aucun arrêt candidat trouvé via Google, recherche GTFS impossible.");
                } else {
                    console.log(`📍 Arrêts candidats GTFS (IDs):`, Array.from(candidateStopIds));
                }

                const serviceIdSet = dataManager.getServiceIds(new Date(reqDate));
                const seenKeys = new Set(); // Pour éviter les doublons exacts

                // Ajouter les clés des bus Google déjà trouvés pour ne pas les dupliquer
                filteredBus.forEach(b => {
                    seenKeys.add(`${b.summarySegments[0]?.name}_${b.arrivalTime}`);
                });

                // PARCOURS GTFS
                for (const stopId of candidateStopIds) {
                    const stopTimes = dataManager.stopTimesByStop[stopId] || [];
                    
                    for (const st of stopTimes) {
                        const trip = dataManager.tripsByTripId[st.trip_id];
                        if (!trip) continue;

                        // Vérif Service (Jour de la semaine)
                        const isServiceActive = Array.from(serviceIdSet).some(sid => dataManager.serviceIdsMatch(trip.service_id, sid));
                        if (!isServiceActive) continue;

                        const arrTimeStr = st.arrival_time || st.departure_time;
                        const seconds = dataManager.timeToSeconds(arrTimeStr);
                        
                        // Calcul du Timestamp Arrivée GTFS
                        const d = new Date(reqDate);
                        const hours = Math.floor(seconds / 3600);
                        const mins = Math.floor((seconds % 3600) / 60);
                        d.setHours(hours, mins, 0, 0);
                        const arrMs = d.getTime();

                        // === TEST CRITIQUE DE LA FENÊTRE ===
                        if (arrMs >= windowStart && arrMs <= windowEnd) {
                            
                            const route = dataManager.getRoute(trip.route_id) || {};
                            const routeName = route.route_short_name || trip.route_id;
                            const key = `${routeName}_${dataManager.formatTime(seconds)}`;

                            if (!seenKeys.has(key)) {
                                seenKeys.add(key); // Marquer comme vu

                                // Création de l'itinéraire GTFS enrichi (noms lisibles, horaires, polylines via shapes)
                                                const stopTimesList = dataManager.getStopTimes(st.trip_id) || [];
                                                const alightIndex = stopTimesList.findIndex(s => s.stop_id === st.stop_id);

                                                // Determine boardingIndex robustly:
                                                // 1) Prefer a stop that matches any origin candidate stop IDs (if available)
                                                // 2) Otherwise, pick the nearest predecessor before alightIndex (within a small window)
                                                let boardingIndex = null;
                                                try {
                                                    // Build origin candidate IDs from the current Google results (departure stops)
                                                    const originCandidateNames = new Set();
                                                    busItins.forEach(bi => {
                                                        if (!bi.steps) return;
                                                        const firstBusStep = [...bi.steps].find(s => s.type === 'BUS');
                                                        if (firstBusStep && firstBusStep.departureStop) originCandidateNames.add(firstBusStep.departureStop);
                                                    });
                                                    const originCandidateIds = new Set();
                                                    originCandidateNames.forEach(n => {
                                                        const key = (n || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '').trim();
                                                        if (dataManager.stopsByName && dataManager.stopsByName[key]) {
                                                            dataManager.stopsByName[key].forEach(s => originCandidateIds.add(s.stop_id));
                                                        } else {
                                                            dataManager.stops.forEach(s => { if ((s.stop_name||'').toLowerCase().includes((n||'').toLowerCase())) originCandidateIds.add(s.stop_id); });
                                                        }
                                                    });
                                                        // Expand candidates via groupedStopMap (include station complexes)
                                                        if (dataManager.groupedStopMap) {
                                                            const toAdd = new Set();
                                                            originCandidateIds.forEach(id => {
                                                                if (dataManager.groupedStopMap[id]) dataManager.groupedStopMap[id].forEach(x => toAdd.add(x));
                                                                // also check parent station mapping
                                                                const stObj = dataManager.getStop(id);
                                                                if (stObj && stObj.parent_station && dataManager.groupedStopMap[stObj.parent_station]) {
                                                                    dataManager.groupedStopMap[stObj.parent_station].forEach(x => toAdd.add(x));
                                                                }
                                                            });
                                                            toAdd.forEach(x => originCandidateIds.add(x));
                                                        }

                                                    if (alightIndex > -1) {
                                                        // search backwards for any origin candidate stop id
                                                        for (let i = Math.min(alightIndex - 1, stopTimesList.length - 1); i >= 0; i--) {
                                                            if (originCandidateIds.size > 0 && originCandidateIds.has(stopTimesList[i].stop_id)) { boardingIndex = i; break; }
                                                        }

                                                        // if none found, pick a reasonable predecessor (up to 3 stops before the alight)
                                                        if (boardingIndex === null) {
                                                            boardingIndex = Math.max(0, alightIndex - 2);
                                                        }
                                                    } else {
                                                        // alightIndex not found: default to first stop or 0
                                                        boardingIndex = 0;
                                                    }
                                                } catch (err) {
                                                    console.warn('Erreur détermination boardingIndex GTFS, fallback utilisé', err);
                                                    boardingIndex = 0;
                                                }

                                                const boardingST = stopTimesList[boardingIndex] || stopTimesList[0] || st;
                                                const alightingST = stopTimesList[alightIndex] || st;

                                                // If we have origin candidate IDs from Google, ensure the chosen boarding stop
                                                // actually matches one of them or is geographically close enough.
                                                // This avoids proposing trips that merely pass the destination stop
                                                // but do not start near the requested origin.
                                                const DIST_THRESHOLD_METERS = 500; // max acceptable walking distance to boarding
                                                if (originCandidateIds && originCandidateIds.size > 0) {
                                                    if (!originCandidateIds.has(boardingST.stop_id)) {
                                                        // Not exact match by ID — compute nearest origin candidate distance
                                                        let minDist = Infinity;
                                                        originCandidateIds.forEach(cid => {
                                                            const cand = dataManager.getStop(cid);
                                                            if (cand && cand.stop_lat && cand.stop_lon && boardingStopObj && boardingStopObj.stop_lat) {
                                                                const d = dataManager.calculateDistance(parseFloat(cand.stop_lat), parseFloat(cand.stop_lon), parseFloat(boardingStopObj.stop_lat), parseFloat(boardingStopObj.stop_lon));
                                                                if (!Number.isNaN(d) && d < minDist) minDist = d;
                                                            }
                                                        });
                                                        if (minDist === Infinity) {
                                                            console.debug('GTFS injection: no origin candidate coordinates to compare, rejecting trip', { tripId: st.trip_id, boarding: boardingST.stop_id });
                                                            continue;
                                                        }
                                                        if (minDist > DIST_THRESHOLD_METERS) {
                                                            console.debug('GTFS injection: boarding stop too far from origin candidates, skip', { tripId: st.trip_id, boarding: boardingST.stop_id, minDist });
                                                            continue;
                                                        }
                                                        // Otherwise accept (within distance threshold)
                                                        console.debug('GTFS injection: boarding stop accepted by proximity', { tripId: st.trip_id, boarding: boardingST.stop_id, minDist });
                                                    } else {
                                                        // Exact match by ID
                                                        console.debug('GTFS injection: boarding stop accepted by exact match', { tripId: st.trip_id, boarding: boardingST.stop_id });
                                                    }
                                                }

                                const depSeconds = dataManager.timeToSeconds(boardingST.departure_time || boardingST.arrival_time || '00:00:00');
                                const arrSeconds = dataManager.timeToSeconds(alightingST.arrival_time || alightingST.departure_time || '00:00:00');

                                const boardingStopObj = dataManager.getStop(boardingST.stop_id) || { stop_name: boardingST.stop_id, stop_lat: 0, stop_lon: 0 };
                                const alightingStopObj = dataManager.getStop(alightingST.stop_id) || { stop_name: alightingST.stop_id, stop_lat: 0, stop_lon: 0 };

                                // Diagnostic: report when readable names are missing or when boarding is far from alight
                                if (!boardingStopObj || !boardingStopObj.stop_name || boardingStopObj.stop_name === boardingST.stop_id) {
                                    console.debug('GTFS injection: boarding stop has no readable name', { tripId: st.trip_id, boardingST });
                                }
                                if (!alightingStopObj || !alightingStopObj.stop_name || alightingStopObj.stop_name === alightingST.stop_id) {
                                    console.debug('GTFS injection: alighting stop has no readable name', { tripId: st.trip_id, alightingST });
                                }

                                // Récupérer géométrie shape/route
                                let geometry = null;
                                if (trip.shape_id) geometry = dataManager.getShapeGeoJSON(trip.shape_id, trip.route_id);
                                if (!geometry) geometry = dataManager.getRouteGeometry(trip.route_id);

                                // Convertir geometry en tableau de [lon, lat] points (comme dans geojson)
                                const extractRouteCoords = (geom) => {
                                    if (!geom) return null;
                                    if (Array.isArray(geom)) return geom; // assume already coords
                                    if (geom.type === 'LineString') return geom.coordinates;
                                    if (geom.type === 'MultiLineString') return geom.coordinates.flat();
                                    return null;
                                };

                                const routeCoords = extractRouteCoords(geometry);
                                let busPolylineEncoded = null;
                                if (routeCoords && routeCoords.length > 0) {
                                    // dataManager.findNearestPointOnRoute expects [lon, lat] pairs
                                    const startIdx = dataManager.findNearestPointOnRoute(routeCoords, parseFloat(boardingStopObj.stop_lat), parseFloat(boardingStopObj.stop_lon));
                                    const endIdx = dataManager.findNearestPointOnRoute(routeCoords, parseFloat(alightingStopObj.stop_lat), parseFloat(alightingStopObj.stop_lon));
                                    let slice = null;
                                    if (startIdx != null && endIdx != null) {
                                        if (startIdx <= endIdx) slice = routeCoords.slice(startIdx, endIdx + 1);
                                        else slice = [...routeCoords].slice(endIdx, startIdx + 1).reverse();
                                    }
                                    if (!slice || slice.length < 2) {
                                        slice = [[parseFloat(boardingStopObj.stop_lon), parseFloat(boardingStopObj.stop_lat)], [parseFloat(alightingStopObj.stop_lon), parseFloat(alightingStopObj.stop_lat)]];
                                    }
                                    // convert [lon,lat] to [lat,lon]
                                    const latlngs = slice.map(p => [p[1], p[0]]);
                                    busPolylineEncoded = encodePolyline(latlngs);
                                }

                                const intermediateStops = [];
                                if (stopTimesList && stopTimesList.length > 0 && alightIndex > boardingIndex) {
                                    const mids = stopTimesList.slice(boardingIndex + 1, alightIndex).map(s => dataManager.getStop(s.stop_id)?.stop_name || s.stop_id);
                                    intermediateStops.push(...mids);
                                }

                                const busStep = {
                                    type: 'BUS',
                                    icon: ICONS.BUS,
                                    instruction: `Prendre ${routeName} vers ${trip.trip_headsign}`,
                                    polyline: busPolylineEncoded ? { encodedPolyline: busPolylineEncoded } : null,
                                    routeColor: route.route_color ? `#${route.route_color}` : '#3388ff',
                                    routeTextColor: route.route_text_color ? `#${route.route_text_color}` : '#ffffff',
                                    routeShortName: routeName,
                                    departureStop: boardingStopObj.stop_name || boardingST.stop_id,
                                    arrivalStop: alightingStopObj.stop_name || alightingST.stop_id,
                                    departureTime: dataManager.formatTime(depSeconds),
                                    arrivalTime: dataManager.formatTime(arrSeconds),
                                    duration: dataManager.formatDuration(Math.max(0, arrSeconds - depSeconds)) || 'Horaires théoriques',
                                    intermediateStops,
                                    numStops: Math.max(0, (alightIndex - boardingIndex)),
                                    _durationSeconds: Math.max(0, arrSeconds - depSeconds)
                                };

                                const itin = {
                                    type: 'BUS',
                                    tripId: st.trip_id,
                                    trip: trip,
                                    route: route,
                                    departureTime: busStep.departureTime || '~',
                                    arrivalTime: busStep.arrivalTime || dataManager.formatTime(seconds),
                                    summarySegments: [{ type: 'BUS', name: routeName, color: route.route_color ? `#${route.route_color}` : '#3388ff', textColor: route.route_text_color ? `#${route.route_text_color}` : '#ffffff' }],
                                    durationRaw: busStep._durationSeconds || 0,
                                    duration: busStep.duration || 'Horaires théoriques',
                                    steps: [busStep]
                                };
                                    // Verify trip headsign/direction loosely matches candidate arrival names to avoid cloning reverse trips
                                    if (trip.trip_headsign) {
                                        const th = (trip.trip_headsign || '').toLowerCase();
                                        const matchesHeadsign = Array.from(candidateNames).some(n => n && th.includes((n || '').toLowerCase()));
                                        if (!matchesHeadsign) {
                                            console.debug('GTFS injection: trip headsign does not match candidate arrival names, skipping', { tripId: st.trip_id, trip_headsign: trip.trip_headsign });
                                            continue;
                                        }
                                    }
                                    gtfsAdded.push(itin);
                            }
                        }
                    }
                }
                console.log(`✅ Bus GTFS ajoutés : ${gtfsAdded.length}`);
            }

            // E. INCLURE LES RÉSULTATS GTFS DANS L'AFFICHAGE (fenêtre stricte: jusqu'à l'heure demandée)
            // On annote d'abord les bus Google confirmés par GTFS
            let matchedCount = 0;
            filteredBus.forEach(it => {
                const key = `${it.summarySegments[0]?.name}_${it.arrivalTime}`;
                const match = gtfsAdded.find(g => `${g.summarySegments[0]?.name}_${g.arrivalTime}` === key);
                // Do not annotate Google itineraries with provenance flags — treat all sources uniformly in UI.
            });

            // Préparer la liste combinée (Google + GTFS) — sans limitation du nombre
            const allBuses = [];
            // Ajouter les bus Google filtrés (déjà dans la fenêtre [req-30min, req])
            filteredBus.forEach(it => {
                allBuses.push({ itin: it, arrivalMs: parseArrivalMs(it.arrivalTime), source: 'google' });
            });
            // Ajouter les bus GTFS trouvés dans la même fenêtre
            gtfsAdded.forEach(g => {
                const arrivalMs = parseArrivalMs(g.arrivalTime);
                // uniquement si dans la fenêtre (sécurité)
                if (!isNaN(arrivalMs) && arrivalMs >= windowStart && arrivalMs <= reqMs) {
                    allBuses.push({ itin: g, arrivalMs: arrivalMs, source: 'gtfs' });
                }
            });

            // Trier chronologiquement par heure d'arrivée
            allBuses.sort((a, b) => a.arrivalMs - b.arrivalMs);

            // Diagnostics GTFS
            const missingGtfs = gtfsAdded.filter(g => !filteredBus.some(f => `${f.summarySegments[0]?.name}_${f.arrivalTime}` === `${g.summarySegments[0]?.name}_${g.arrivalTime}`));
            itineraries._gtfsDiagnostics = {
                candidateStopIds: Array.from(candidateStopIds || []),
                gtfsFound: gtfsAdded.length,
                googleFound: filteredBus.length,
                matched: matchedCount,
                missing: missingGtfs.map(g => ({ route: g.summarySegments[0]?.name, arrival: g.arrivalTime, tripId: g.tripId }))
            };

            if (missingGtfs.length > 0) {
                console.warn(`⚠️ GTFS: ${missingGtfs.length} départ(s) trouvés dans GTFS mais non proposés par l'API Google.`);
                console.table(itineraries._gtfsDiagnostics.missing);
            } else {
                console.log('✅ GTFS et Google cohérents pour cette fenêtre.');
            }

            // F. RECONSTRUIRE LA LISTE FINALE: inclure TOUS les bus (Google + GTFS) sans limite
            itineraries.length = 0;
            allBuses.forEach(b => itineraries.push(b.itin));
            // Rajouter piéton/vélo à la fin
            itineraries.push(...otherItins);
        }
    } catch (e) {
        console.warn('Erreur lors du filtrage par heure d\'arrivée:', e);
    }

    return itineraries; // On ne trie plus par score ici si on est en mode "arriver", l'ordre chrono est mieux.
}

/**
 * Ensure every BUS step has a polyline. Attempts to reconstruct from GTFS data (shape or route geometry)
 * and falls back to a straight encoded line between boarding and alighting stops when necessary.
 * This is defensive: some GTFS-inserted itineraries may miss polylines and the renderer expects them.
 */
async function ensureItineraryPolylines(itineraries) {
    if (!Array.isArray(itineraries) || !dataManager) return;

    const normalize = (s) => (s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]/g, '').trim();

    for (const itin of itineraries) {
        if (!itin || !Array.isArray(itin.steps)) continue;
        for (const step of itin.steps) {
            try {
                if (!step || step.type !== 'BUS') continue;
                // If polyline already present, skip
                if (step.polyline && (step.polyline.encodedPolyline || step.polyline.points)) continue;

                // Try to find departure/arrival stops via stop names (fast path)
                let depStopObj = null, arrStopObj = null;
                try {
                    if (step.departureStop) {
                        const candidates = (dataManager.findStopsByName && dataManager.findStopsByName(step.departureStop, 3)) || [];
                        if (candidates.length) depStopObj = candidates[0];
                    }
                    if (step.arrivalStop) {
                        const candidates = (dataManager.findStopsByName && dataManager.findStopsByName(step.arrivalStop, 3)) || [];
                        if (candidates.length) arrStopObj = candidates[0];
                    }

                    // If still missing, try to use itinerary-level info (trip/route) and match by times or stop_id
                    if ((!depStopObj || !arrStopObj) && itin.tripId) {
                        const stopTimes = dataManager.getStopTimes(itin.tripId) || [];
                        if (stopTimes.length >= 1) {
                            // Attempt to match by departureTime/arrivalTime strings if available
                            if (!depStopObj && step.departureTime && step.departureTime !== '~') {
                                const match = stopTimes.find(st => (st.departure_time || st.arrival_time) && ((st.departure_time && st.departure_time.startsWith(step.departureTime)) || (st.arrival_time && st.arrival_time.startsWith(step.departureTime))));
                                if (match) depStopObj = dataManager.getStop(match.stop_id);
                            }
                            if (!arrStopObj && step.arrivalTime && step.arrivalTime !== '~') {
                                const match = stopTimes.find(st => (st.arrival_time || st.departure_time) && ((st.arrival_time && st.arrival_time.startsWith(step.arrivalTime)) || (st.departure_time && st.departure_time.startsWith(step.arrivalTime))));
                                if (match) arrStopObj = dataManager.getStop(match.stop_id);
                            }

                            // If still not found, try matching by raw stop_id if the UI shows one (some raw IDs include ':')
                            if (!depStopObj && step.departureStop && step.departureStop.indexOf(':') !== -1) {
                                depStopObj = dataManager.getStop(step.departureStop) || depStopObj;
                            }
                            if (!arrStopObj && step.arrivalStop && step.arrivalStop.indexOf(':') !== -1) {
                                arrStopObj = dataManager.getStop(step.arrivalStop) || arrStopObj;
                            }

                            // Final fallback from stopTimes: choose first/last stops if one side still missing
                            if (!depStopObj && stopTimes.length) depStopObj = dataManager.getStop(stopTimes[0].stop_id);
                            if (!arrStopObj && stopTimes.length) arrStopObj = dataManager.getStop(stopTimes[stopTimes.length - 1].stop_id);
                        }
                    }
                } catch (err) {
                    console.warn('ensureItineraryPolylines: erreur résolution arrêts', err);
                }

                // Build encoded polyline from route geometry when possible
                let encoded = null;
                const routeId = (itin.route && (itin.route.route_id || itin.routeId)) || null;
                const shapeId = (itin.trip && itin.trip.shape_id) || (itin.shapeId) || null;

                let geometry = null;
                if (shapeId) geometry = dataManager.getShapeGeoJSON(shapeId, routeId);
                if (!geometry && routeId) geometry = dataManager.getRouteGeometry(routeId);

                const geometryToLatLngs = (geom) => {
                    if (!geom) return null;
                    if (Array.isArray(geom)) return geom.map(p => [p[0], p[1]]);
                    if (geom.type === 'LineString') return geom.coordinates.map(p => [p[1], p[0]]);
                    if (geom.type === 'MultiLineString') return geom.coordinates.flat().map(p => [p[1], p[0]]);
                    return null;
                };

                const latlngs = geometryToLatLngs(geometry);

                if (latlngs && latlngs.length >= 2 && depStopObj && arrStopObj) {
                    // find nearest indices
                    const findNearestIdx = (points, targetLat, targetLon) => {
                        let best = 0; let bestD = Infinity;
                        for (let i = 0; i < points.length; i++) {
                            const d = dataManager.calculateDistance(targetLat, targetLon, points[i][0], points[i][1]);
                            if (d < bestD) { bestD = d; best = i; }
                        }
                        return best;
                    };
                    const startIdx = findNearestIdx(latlngs, parseFloat(depStopObj.stop_lat), parseFloat(depStopObj.stop_lon));
                    const endIdx = findNearestIdx(latlngs, parseFloat(arrStopObj.stop_lat), parseFloat(arrStopObj.stop_lon));
                    let slice = null;
                    if (startIdx != null && endIdx != null && startIdx !== endIdx) {
                        if (startIdx < endIdx) slice = latlngs.slice(startIdx, endIdx + 1);
                        else slice = [...latlngs].slice(endIdx, startIdx + 1).reverse();
                    }
                    if (!slice || slice.length < 2) slice = [[parseFloat(depStopObj.stop_lat), parseFloat(depStopObj.stop_lon)], [parseFloat(arrStopObj.stop_lat), parseFloat(arrStopObj.stop_lon)]];
                    encoded = encodePolyline(slice);
                }

                // Final fallback: direct straight line using available coordinates
                if (!encoded) {
                    const dep = depStopObj ? { lat: parseFloat(depStopObj.stop_lat), lon: parseFloat(depStopObj.stop_lon) } : null;
                    const arr = arrStopObj ? { lat: parseFloat(arrStopObj.stop_lat), lon: parseFloat(arrStopObj.stop_lon) } : null;
                    if (dep && arr && !Number.isNaN(dep.lat) && !Number.isNaN(arr.lat)) {
                        encoded = encodePolyline([[dep.lat, dep.lon], [arr.lat, arr.lon]]);
                    }
                }

                if (encoded) {
                    step.polyline = { encodedPolyline: encoded };
                    console.debug('ensureItineraryPolylines: reconstructed polyline', { itinId: itin.tripId || itin.trip?.trip_id || null });
                } else {
                    console.warn('ensureItineraryPolylines: impossible de reconstruire la polyline pour une étape BUS (aucune coordonnée fiable)', { itin: itin, step });
                }
            } catch (err) {
                console.warn('ensureItineraryPolylines error for step', err);
            }
        }
    }
}
function processSimpleRoute(data, mode, modeInfo, searchTime) { 
    if (!data || !data.routes || data.routes.length === 0 || !modeInfo) return null;
    const route = data.routes[0];
    const leg = route.legs[0];
    const durationMinutes = modeInfo.duration;
    const distanceKm = modeInfo.distance;
    const durationRawSeconds = durationMinutes * 60;
    const icon = mode === 'bike' ? ICONS.BICYCLE : ICONS.WALK;
    const modeLabel = mode === 'bike' ? 'Vélo' : 'Marche';
    const type = mode === 'bike' ? 'BIKE' : 'WALK';
    
    let departureTimeStr = "~";
    let arrivalTimeStr = "~";
    if (searchTime.type === 'partir') {
        try {
            let departureDate;
            if(searchTime.date === 'today' || searchTime.date === "Aujourd'hui" || !searchTime.date) {
                departureDate = new Date();
            } else {
                departureDate = new Date(searchTime.date);
            }
            departureDate.setHours(searchTime.hour, searchTime.minute, 0, 0);
            const arrivalDate = new Date(departureDate.getTime() + durationRawSeconds * 1000);
            departureTimeStr = `${String(departureDate.getHours()).padStart(2, '0')}:${String(departureDate.getMinutes()).padStart(2, '0')}`;
            arrivalTimeStr = `${String(arrivalDate.getHours()).padStart(2, '0')}:${String(arrivalDate.getMinutes()).padStart(2, '0')}`;
        } catch(e) {
            console.warn("Erreur calcul date pour vélo/marche", e);
        }
    }

    const aggregatedStep = {
        type: type, icon: icon, instruction: modeLabel,
        distance: `${distanceKm} km`, duration: `${durationMinutes} min`,
        subSteps: [], polylines: [], departureTime: "~", arrivalTime: "~"
    };

    leg.steps.forEach(step => {
        const distanceText = step.localizedValues?.distance?.text || '';
        const instruction = step.navigationInstruction?.instructions || step.localizedValues?.instruction || (mode === 'bike' ? "Continuer à vélo" : "Marcher");
        const duration = formatGoogleDuration(step.staticDuration); 
        const maneuver = step.navigationInstruction?.maneuver || 'DEFAULT';
        aggregatedStep.subSteps.push({ instruction, distance: distanceText, duration, maneuver });
        aggregatedStep.polylines.push(step.polyline);
    });
    
    return {
        type: type, departureTime: departureTimeStr, arrivalTime: arrivalTimeStr,
        duration: `${durationMinutes} min`, durationRaw: durationRawSeconds,
        polyline: route.polyline, summarySegments: [], steps: [aggregatedStep],
        _isBike: mode === 'bike', _isWalk: mode ==='walk'
    };
}

function setupResultTabs(itineraries) {
    if (!resultsModeTabs) return;
    const tabs = {
        ALL: resultsModeTabs.querySelector('[data-mode="ALL"]'),
        BUS: resultsModeTabs.querySelector('[data-mode="BUS"]'),
        BIKE: resultsModeTabs.querySelector('[data-mode="BIKE"]'),
        WALK: resultsModeTabs.querySelector('[data-mode="WALK"]')
    };
    const bestAll = itineraries[0];
    const bestBus = itineraries.find(i => i.type === 'BUS');
    const bestBike = itineraries.find(i => i.type === 'BIKE');
    const bestWalk = itineraries.find(i => i.type === 'WALK');

    const fillTab = (tab, itinerary, icon) => {
        if (!tab) return;
        let durationHtml = `<span class="mode-tab-duration empty">--</span>`;
        let iconHtml = icon;
        if (itinerary) {
            durationHtml = `<span class="mode-tab-duration">${itinerary.duration}</span>`;
            if (tab === tabs.ALL) iconHtml = ICONS.ALL;
            tab.classList.remove('hidden');
        } else {
            tab.classList.add('hidden'); 
        }
        tab.innerHTML = `${iconHtml}${durationHtml}`;
    };

    fillTab(tabs.ALL, bestAll, ICONS.ALL);
    fillTab(tabs.BUS, bestBus, ICONS.BUS);
    fillTab(tabs.BIKE, bestBike, ICONS.BICYCLE);
    fillTab(tabs.WALK, bestWalk, ICONS.WALK);

    resultsModeTabs.querySelectorAll('.mode-tab').forEach(tab => {
        const newTab = tab.cloneNode(true);
        tab.parentNode.replaceChild(newTab, tab);
        newTab.addEventListener('click', () => {
            resultsModeTabs.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
            newTab.classList.add('active');
            const mode = newTab.dataset.mode;
            renderItineraryResults(mode);
        });
    });
    const defaultActiveTab = resultsModeTabs.querySelector('[data-mode="ALL"]');
    if (defaultActiveTab) {
        defaultActiveTab.classList.add('active');
    }
    resultsModeTabs.classList.remove('hidden');
}

// ===================================================================
// main.js - V47 (Partie 2/2 : Rendu visuel et Marqueurs)
// ... (suite de la Partie 1)
//
// *** MODIFICATION V52 (Partie 2) ***
// 1. (Logique de titrage V52 - sera remplacée par V56)
//
// *** MODIFICATION V53 (Partie 2) ***
// 1. (Corrections de filtrage V53 - sera remplacée par V56)
//
// *** MODIFICATION V56 (Partie 2) ***
// 1. Logique de titrage dans `renderItineraryResults` entièrement révisée
//    pour lireSigma
//
// *** MODIFICATION V57.1 (Partie 2) ***
// 1. Correction du SyntaxError: "Illegal continue statement" (remplacé par "return")
//    dans la fonction `initializeRouteFilter`.
// ===================================================================

/**
 * Affiche les itinéraires formatés dans la liste des résultats
 */
function renderItineraryResults(modeFilter) {
    if (!resultsListContainer) return;
    
    resultsListContainer.innerHTML = ''; 

    // 1. Filtrer les itinéraires
    let itinerariesToRender;
    
    // ✅ V53 (Logique conservée): L'onglet "ALL" (Suggéré) doit afficher 
    // TOUS les itinéraires, qui seront ensuite groupés.
    if (modeFilter === 'ALL') {
        itinerariesToRender = allFetchedItineraries;
    } else {
        // Les autres onglets filtrent par type
        itinerariesToRender = allFetchedItineraries.filter(i => i.type === modeFilter);
    }

    if (itinerariesToRender.length === 0) {
        let message = "Aucun itinéraire trouvé pour ce mode.";
        if (modeFilter === 'ALL') message = "Aucun itinéraire n'a été trouvé.";
        resultsListContainer.innerHTML = `<p class="results-message">${message}</p>`;
        return;
    }

    // ✅ V56 (CORRECTION): Déclaration des variables pour la logique de titrage
    let hasShownBusTitle = false;
    let hasShownBikeTitle = false;
    let hasShownWalkTitle = false;

    itinerariesToRender.forEach((itinerary, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'route-option-wrapper';
        
        // --- ✅ V56 (CORRECTION LOGIQUE DE TITRAGE) ---
        let title = '';
        
        // 3. (V56) S'assurer que le type est valide (robustesse)
        let itinType = itinerary.type;
        if (!itinType) {
             if (itinerary.summarySegments && itinerary.summarySegments.length > 0) itinType = 'BUS';
             else if (itinerary._isBike) itinType = 'BIKE';
             else if (itinerary._isWalk) itinType = 'WALK';
        }

        if (modeFilter === 'ALL') { // Uniquement sur l'onglet "Suggéré"
            
            // Gérer le "Suggéré" (index 0)
            if (index === 0) {
                title = 'Suggéré';
                // Marquer le type comme "affiché"
                if (itinType === 'BUS') hasShownBusTitle = true;
                if (itinType === 'BIKE') hasShownBikeTitle = true;
                if (itinType === 'WALK') hasShownWalkTitle = true;
            }
            
            // Gérer les autres titres de section
            // (Nous n'utilisons PLUS previousItinerary.type)
            if (itinType === 'BUS' && !hasShownBusTitle) {
                title = 'Itinéraires Bus';
                hasShownBusTitle = true;
            } 
            else if (itinType === 'BIKE' && !hasShownBikeTitle) {
                title = 'Itinéraires Vélo';
                hasShownBikeTitle = true;
            } 
            else if (itinType === 'WALK' && !hasShownWalkTitle) {
                title = 'Itinéraires Piéton';
                hasShownWalkTitle = true;
            }
        }
        // --- FIN LOGIQUE DE TITRE V56 ---
        
        if(title) {
            wrapper.innerHTML += `<p class="route-option-title">${title}</p>`;
        }


        const card = document.createElement('div');
        card.className = 'route-option';
        
        let summarySegmentsHtml = '';
        let cardTitle = ''; // ✅ NOUVEAU: Titre à l'intérieur de la carte

        if (itinType === 'BIKE') { // V56: Utilise itinType
            // V45: Utilise la distance de l'étape agrégée
            cardTitle = `Trajet à vélo (${itinerary.steps[0].distance})`;
            summarySegmentsHtml = `
                <div class="route-summary-bus-icon" style="color: #059669; border-color: #059669;">
                    ${ICONS.BICYCLE}
                </div>
                <span style="font-weight: 600; font-size: 0.9rem;">${cardTitle}</span>`;
        } else if (itinType === 'WALK') { // V56: Utilise itinType
            // V45: Utilise la distance de l'étape agrégée
            cardTitle = `Trajet à pied (${itinerary.steps[0].distance})`;
            summarySegmentsHtml = `
                <div class="route-summary-bus-icon" style="color: var(--secondary); border-color: var(--secondary);">
                    ${ICONS.WALK}
                </div>
                <span style="font-weight: 600; font-size: 0.9rem;">${cardTitle}</span>`;
        } else { // V56: Par défaut (BUS)
            // ✅ V48 (MODIFICATION IMPLÉMENTÉE): Utilise l'icône SVG pour le BUS
            summarySegmentsHtml = `<div class="route-summary-bus-icon" style="color: var(--primary); border-color: var(--primary);">
                                       ${ICONS.BUS}
                                   </div>`;
            
            // Logique BUS (existante)
            itinerary.summarySegments.forEach((segment, index) => {
                summarySegmentsHtml += `
                    <div class="route-line-badge" style="background-color: ${segment.color}; color: ${segment.textColor};">${segment.name}</div>
                `;
                
                if (index < itinerary.summarySegments.length - 1) {
                    summarySegmentsHtml += `<span class="route-summary-dot">•</span>`;
                }
            });
        }
        
        // L'icône "éco" ne s'affiche que pour le tout premier résultat de l'onglet "TOUS"
        // V52: Logique modifiée pour s'adapter au titre "Suggéré"
        const isBestSuggere = (index === 0 && modeFilter === 'ALL');
        
        const durationHtml = (isBestSuggere && itinType === 'BUS') // V56: Utilise itinType
            ? `<span class="route-duration-eco">${ICONS.LEAF_ICON} ${itinerary.duration}</span>`
            : `<span>${itinerary.duration}</span>`;

        // Gérer les heures de départ/arrivée pour Vélo/Marche
        const timeHtml = (itinerary.departureTime === '~')
            ? `<span class="route-time" style="color: var(--text-secondary); font-weight: 500;">(Trajet)</span>`
            : `<span class="route-time">${itinerary.departureTime} &gt; ${itinerary.arrivalTime}</span>`;


        card.innerHTML = `
            <div class="route-summary-line">
                ${summarySegmentsHtml}
            </div>
            <div class="route-footer">
                ${timeHtml}
                <span class="route-duration">${durationHtml}</span>
            </div>
        `;
        
        
        // Logique Clic (PC vs Mobile)
        card.addEventListener('click', () => {
            const isMobile = window.innerWidth <= 768;
            
            // ✅ MODIFICATION V44: Passe l'objet itinéraire entier
            drawRouteOnResultsMap(itinerary);
            
            if (isMobile) {
                // ✅ V48 (MODIFICATION IMPLÉMENTÉE): 
                // 1. On récupère la couche de trajet créée
                const routeLayer = renderItineraryDetail(itinerary);
                // 2. On la passe à showDetailView pour qu'IL gère le zoom
                showDetailView(routeLayer);
            } else {
                // ✅ CORRECTION: Logique Desktop simplifiée
                const allCards = resultsListContainer.querySelectorAll('.route-option');
                const allDetails = resultsListContainer.querySelectorAll('.route-details');
                const detailDiv = card.nextElementSibling; // Devrait exister pour tous

                if (card.classList.contains('is-active')) {
                    // Clic sur l'élément déjà actif: on ferme tout
                    card.classList.remove('is-active');
                    if (detailDiv) detailDiv.classList.add('hidden');
                } else {
                    // Clic sur un nouvel élément: on ferme les autres, on ouvre celui-ci
                    allCards.forEach(c => c.classList.remove('is-active'));
                    allDetails.forEach(d => d.classList.add('hidden'));
                    
                    card.classList.add('is-active');
                    
                    // On ouvre le 'detailDiv' s'il existe
                    if (detailDiv) {
                        detailDiv.classList.remove('hidden');
                        // On le remplit s'il est vide (1ère ouverture)
                        if (!detailDiv.hasChildNodes()) {
                            detailDiv.innerHTML = renderItineraryDetailHTML(itinerary);
                        }
                    }
                }
            }
        });


        wrapper.appendChild(card);
        
        // ✅ CORRECTION: Crée un div "details" pour TOUS les types
        // (il sera rempli au clic par renderItineraryDetailHTML)
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'route-details hidden';
        wrapper.appendChild(detailsDiv);
        
        resultsListContainer.appendChild(wrapper);
    });
}

/**
 * *** MODIFIÉ V44 ***
 * Helper pour déterminer le style Leaflet (couleur, hachures)
 * en fonction d'une ÉTAPE d'itinéraire.
 */
function getLeafletStyleForStep(step) {
    // Vérifie le type simple (vélo/marche)
    if (step.type === 'BIKE') {
        return {
            color: 'var(--secondary)', // Gris
            weight: 5,
            opacity: 0.8
        };
    }
    if (step.type === 'WALK') {
        return {
            color: 'var(--primary)', // Bleu (couleur primaire)
            weight: 5,
            opacity: 0.8,
            dashArray: '10, 10' // Hachuré
        };
    }
    // Vérifie le type Bus
    if (step.type === 'BUS') {
        const busColor = step.routeColor || 'var(--primary)'; // Fallback
        return {
            color: busColor,
            weight: 5,
            opacity: 0.8
        };
    }
    
    // Fallback pour les types Google (au cas où)
    if (step.travelMode === 'BICYCLE') return getLeafletStyleForStep({type: 'BIKE'});
    if (step.travelMode === 'WALK') return getLeafletStyleForStep({type: 'WALK'});
    if (step.travelMode === 'TRANSIT') return getLeafletStyleForStep({type: 'BUS', routeColor: step.routeColor});

    // Style par défaut
    return {
        color: 'var(--primary)',
        weight: 5,
        opacity: 0.8
    };
}

/**
 * ✅ NOUVELLE FONCTION V46
 * Ajoute les marqueurs de Début, Fin et Correspondance sur une carte
 */
function addItineraryMarkers(itinerary, map, markerLayer) {
    if (!itinerary || !itinerary.steps || !map || !markerLayer) return;

    markerLayer.clearLayers();
    const markers = [];

    // 1. Marqueur de DÉPART
    const firstStep = itinerary.steps[0];
    const firstPolyline = (firstStep.type === 'BUS') ? firstStep.polyline : firstStep.polylines[0];
    if (firstPolyline && firstPolyline.encodedPolyline) {
        const decoded = decodePolyline(firstPolyline.encodedPolyline);
        if (decoded.length > 0) {
            const [lat, lng] = decoded[0];
            const startIcon = L.divIcon({
                className: 'itinerary-marker-icon start',
                html: ICONS.MARKERS.START,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });
            markers.push(L.marker([lat, lng], { icon: startIcon, zIndexOffset: 1000 }));
        }
    }

    // 2. Marqueurs de CORRESPONDANCE
    for (let i = 0; i < itinerary.steps.length - 1; i++) {
        const currentStep = itinerary.steps[i];
        
        // On place un marqueur à la FIN de chaque étape (sauf la dernière)
        const lastPolyline = (currentStep.type === 'BUS') 
            ? currentStep.polyline 
            : currentStep.polylines[currentStep.polylines.length - 1];
        
        if (lastPolyline && lastPolyline.encodedPolyline) {
            const decoded = decodePolyline(lastPolyline.encodedPolyline);
            if (decoded.length > 0) {
                const [lat, lng] = decoded[decoded.length - 1];
                const corrIcon = L.divIcon({
                    className: 'itinerary-marker-icon correspondence',
                    html: ICONS.MARKERS.CORRESPONDENCE,
                    iconSize: [20, 20],
                    iconAnchor: [10, 10]
                });
                markers.push(L.marker([lat, lng], { icon: corrIcon, zIndexOffset: 900 }));
            }
        }
    }

    // 3. Marqueur de FIN
    const lastStep = itinerary.steps[itinerary.steps.length - 1];
    const lastPolyline = (lastStep.type === 'BUS') 
        ? lastStep.polyline 
        : lastStep.polylines[lastStep.polylines.length - 1];
    
    if (lastPolyline && lastPolyline.encodedPolyline) {
        const decoded = decodePolyline(lastPolyline.encodedPolyline);
        if (decoded.length > 0) {
            const [lat, lng] = decoded[decoded.length - 1];
            const endIcon = L.divIcon({
                className: 'itinerary-marker-icon end',
                html: ICONS.MARKERS.END,
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            });
            markers.push(L.marker([lat, lng], { icon: endIcon, zIndexOffset: 1000 }));
        }
    }

    // Ajouter tous les marqueurs à la couche
    markers.forEach(marker => markerLayer.addLayer(marker));
}


/**
 * *** MODIFIÉ V46 (Marqueurs) ***
 * Dessine un tracé sur la carte des résultats PC
 */
function drawRouteOnResultsMap(itinerary) {
    if (!resultsMapRenderer || !resultsMapRenderer.map || !itinerary || !itinerary.steps) return;

    if (currentResultsRouteLayer) {
        resultsMapRenderer.map.removeLayer(currentResultsRouteLayer);
        currentResultsRouteLayer = null;
    }
    // ✅ V46: Vider les anciens marqueurs
    if (currentResultsMarkerLayer) {
        currentResultsMarkerLayer.clearLayers();
    }

    const stepLayers = [];
    
    itinerary.steps.forEach(step => {
        const style = getLeafletStyleForStep(step);
        
        // ✅ V45: Gérer les polylines agrégées (marche/vélo) ou simples (bus)
        const polylinesToDraw = (step.type === 'BUS') 
            ? [step.polyline] // Le bus a une seule polyline
            : step.polylines;  // La marche/vélo ont un tableau de polylines

        if (!polylinesToDraw) return;

        polylinesToDraw.forEach(polyline => {
            if (!polyline || !polyline.encodedPolyline) {
                console.warn("Étape sans polyline:", step);
                return;
            }

            // ✅ FIX V42: Décoder la polyline encodée de Google
            let coordinates;
            try {
                const decoded = decodePolyline(polyline.encodedPolyline);
                coordinates = {
                    type: "LineString",
                    coordinates: decoded.map(coord => [coord[1], coord[0]]) // [lng, lat]
                };
            } catch (e) {
                console.error("Erreur décodage polyline d'étape:", e, polyline.encodedPolyline);
                return;
            }
                
            if (coordinates) {
                const stepLayer = L.geoJSON(coordinates, {
                    style: style // Utiliser le style dynamique de l'étape
                });
                stepLayers.push(stepLayer);
            }
        });
    });

    if (stepLayers.length > 0) {
        // Créer un groupe avec toutes les couches d'étapes
        currentResultsRouteLayer = L.featureGroup(stepLayers).addTo(resultsMapRenderer.map);
        
        // ✅ V46: Ajouter les marqueurs
        addItineraryMarkers(itinerary, resultsMapRenderer.map, currentResultsMarkerLayer);

        // Ajuster la carte pour voir l'ensemble du trajet
        resultsMapRenderer.map.fitBounds(currentResultsRouteLayer.getBounds(), { padding: [20, 20] });
    }
}


/**
 * *** MODIFIÉ V46 (Icônes Manœuvre + Filtre Bruit) ***
 * Génère le HTML des détails pour l'accordéon PC (Bus)
 */
function renderItineraryDetailHTML(itinerary) {
    
    const stepsHtml = itinerary.steps.map(step => {
        // ✅ V45: Logique de marche (et vélo) restaurée avec <details>
        if (step.type === 'WALK' || step.type === 'BIKE') {
            const hasSubSteps = step.subSteps && step.subSteps.length > 0;
            const icon = (step.type === 'BIKE') ? ICONS.BICYCLE : ICONS.WALK;
            const stepClass = (step.type === 'BIKE') ? 'bicycle' : 'walk';

            // ✅ V46: Filtrer les étapes "STRAIGHT" trop courtes
            const filteredSubSteps = step.subSteps.filter(subStep => {
                const distanceMatch = subStep.distance.match(/(\d+)\s*m/);
                if (subStep.maneuver === 'STRAIGHT' && distanceMatch && parseInt(distanceMatch[1]) < 100) {
                    return false; // Ne pas afficher "Continuer tout droit (80m)"
                }
                return true;
            });

            return `
                <div class="step-detail ${stepClass}" style="--line-color: var(--text-secondary);">
                    <div class="step-icon">
                        ${icon}
                    </div>
                    <div class="step-info">
                        <span class="step-instruction">${step.instruction} <span class="step-duration-inline">(${step.duration})</span></span>
                        
                        ${hasSubSteps ? `
                        <details class="intermediate-stops">
                            <summary>
                                <span>Voir les étapes</span>
                                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </summary>
                            <ul class="intermediate-stops-list walk-steps">
                                ${filteredSubSteps.map(subStep => `
                                    <li>
                                        ${getManeuverIcon(subStep.maneuver)}
                                        <div class="walk-step-info">
                                            <span>${subStep.instruction}</span>
                                            <span class="walk-step-meta">${subStep.distance} (${subStep.duration})</span>
                                        </div>
                                    </li>
                                `).join('')}
                            </ul>
                        </details>
                        ` : `<span class="step-sub-instruction">${step.instruction}</span>`}
                    </div>
                </div>
            `;
        } else { // BUS
            const hasIntermediateStops = step.intermediateStops && step.intermediateStops.length > 0;
            const intermediateStopCount = hasIntermediateStops ? step.intermediateStops.length : (step.numStops > 1 ? step.numStops - 1 : 0);
            
            let stopCountLabel = 'Direct';
            if (intermediateStopCount > 1) {
                stopCountLabel = `${intermediateStopCount} arrêts`;
            } else if (intermediateStopCount === 1) {
                stopCountLabel = `1 arrêt`;
            }

            const lineColor = step.routeColor || 'var(--border)';
            
            return `
                <div class="step-detail bus" style="--line-color: ${lineColor};">
                    <div class="step-icon">
                        <div class="route-line-badge" style="background-color: ${step.routeColor}; color: ${step.routeTextColor};">${step.routeShortName}</div>
                    </div>
                    <div class="step-info">
                        <span class="step-instruction">${step.instruction} <span class="step-duration-inline">(${step.duration})</span></span>
                        
                        <div class="step-stop-point">
                            <span class="step-time">Montée à <strong>${step.departureStop}</strong></span>
                            <span class="step-time-detail">(${step.departureTime})</span>
                        </div>
                        
                        ${(intermediateStopCount > 0) ? `
                        <details class="intermediate-stops">
                            <summary>
                                <span>${stopCountLabel}</span>
                                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </summary>
                            ${hasIntermediateStops ? `
                            <ul class="intermediate-stops-list" style="--line-color: ${lineColor};">
                                ${step.intermediateStops.map(stopName => `<li>${stopName}</li>`).join('')}
                            </ul>
                            ` : `<ul class="intermediate-stops-list" style="--line-color: ${lineColor};"><li>(La liste détaillée des arrêts n'est pas disponible)</li></ul>`}
                        </details>
                        ` : ''}
                        
                        <div class="step-stop-point">
                            <span class="step-time">Descente à <strong>${step.arrivalStop}</strong></span>
                            <span class="step-time-detail">(${step.arrivalTime})</span>
                        </div>
                    </div>
                </div>
            `;
        }
    }).join('');
    
    return stepsHtml;
}


/**
 * *** MODIFIÉ V48 (Zoom Mobile) ***
 * Remplit l'écran 2 (Détail Mobile)
 * NE FAIT PLUS le fitBounds, mais RETOURNE la couche
 */
function renderItineraryDetail(itinerary) {
    if (!detailPanelContent || !detailMapRenderer) return;

    let stepsHtml = '';

    // ✅ V45: Logique de marche (et vélo) restaurée avec <details>
    stepsHtml = itinerary.steps.map(step => {
        const lineColor = (step.type === 'BUS') ? (step.routeColor || 'var(--border)') : 'var(--text-secondary)';
        
        if (step.type === 'WALK' || step.type === 'BIKE') {
            const hasSubSteps = step.subSteps && step.subSteps.length > 0;
            const icon = (step.type === 'BIKE') ? ICONS.BICYCLE : ICONS.WALK;
            const stepClass = (step.type === 'BIKE') ? 'bicycle' : 'walk';

            // ✅ V46: Filtrer les étapes "STRAIGHT" trop courtes
            const filteredSubSteps = step.subSteps.filter(subStep => {
                // Tente d'extraire les mètres
                const distanceMatch = subStep.distance.match(/(\d+)\s*m/);
                // Si c'est "STRAIGHT" ET que la distance est < 100m, on cache
                if (subStep.maneuver === 'STRAIGHT' && distanceMatch && parseInt(distanceMatch[1]) < 100) {
                    return false; 
                }
                return true;
            });

            return `
                <div class="step-detail ${stepClass}" style="--line-color: ${lineColor};">
                    <div class="step-icon">
                        ${icon}
                    </div>
                    <div class="step-info">
                        <span class="step-instruction">${step.instruction} <span class="step-duration-inline">(${step.duration})</span></span>
                        
                        ${hasSubSteps ? `
                        <details class="intermediate-stops">
                            <summary>
                                <span>Voir les étapes</span>
                                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </summary>
                            <ul class="intermediate-stops-list walk-steps">
                                ${filteredSubSteps.map(subStep => `
                                    <li>
                                        ${getManeuverIcon(subStep.maneuver)}
                                        <div class="walk-step-info">
                                            <span>${subStep.instruction}</span>
                                            <span class="walk-step-meta">${subStep.distance} ${subStep.duration ? `(${subStep.duration})` : ''}</span>
                                        </div>
                                    </li>
                                `).join('')}
                            </ul>
                        </details>
                        ` : `<span class="step-sub-instruction">${step.instruction}</span>`}
                    </div>
                </div>
            `;
        } else { // BUS
            const hasIntermediateStops = step.intermediateStops && step.intermediateStops.length > 0;
            const intermediateStopCount = hasIntermediateStops ? step.intermediateStops.length : (step.numStops > 1 ? step.numStops - 1 : 0);
            
            let stopCountLabel = 'Direct';
            if (intermediateStopCount > 1) {
                stopCountLabel = `${intermediateStopCount} arrêts`;
            } else if (intermediateStopCount === 1) {
                stopCountLabel = `1 arrêt`;
            }

            return `
                <div class="step-detail bus" style="--line-color: ${lineColor};">
                    <div class="step-icon">
                        <div class="route-line-badge" style="background-color: ${step.routeColor}; color: ${step.routeTextColor};">${step.routeShortName}</div>
                    </div>
                    <div class="step-info">
                        <span class="step-instruction">${step.instruction} <span class="step-duration-inline">(${step.duration})</span></span>
                        
                        <div class="step-stop-point">
                            <span class="step-time">Montée à <strong>${step.departureStop}</strong></span>
                            <span class="step-time-detail">(${step.departureTime})</span>
                        </div>
                        
                        ${(intermediateStopCount > 0) ? `
                        <details class="intermediate-stops">
                            <summary>
                                <span>${stopCountLabel}</span>
                                <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
                            </summary>
                            ${hasIntermediateStops ? `
                            <ul class="intermediate-stops-list" style="--line-color: ${lineColor};">
                                ${step.intermediateStops.map(stopName => `<li>${stopName}</li>`).join('')}
                            </ul>
                            ` : `<ul class="intermediate-stops-list" style="--line-color: ${lineColor};"><li>(La liste détaillée des arrêts n'est pas disponible)</li></ul>`}
                        </details>
                        ` : ''}
                        
                        <div class="step-stop-point">
                            <span class="step-time">Descente à <strong>${step.arrivalStop}</strong></span>
                            <span class="step-time-detail">(${step.arrivalTime})</span>
                        </div>
                    </div>
                </div>
            `;
        }
    }).join('');

    detailPanelContent.innerHTML = stepsHtml;

    // 2. Mettre à jour le résumé
    if(detailMapSummary) {
        // ✅ CORRECTION: Affiche les temps calculés pour Vélo/Marche
        const timeHtml = (itinerary.departureTime === '~')
            ? `<span class="route-time" style="color: var(--text-secondary); font-weight: 500;">(Trajet)</span>`
            : `<span class="route-time">${itinerary.departureTime} &gt; ${itinerary.arrivalTime}</span>`;

        detailMapSummary.innerHTML = `
            ${timeHtml}
            <span class="route-duration">${itinerary.duration}</span>
        `;
    }

    // 3. Dessiner le tracé sur la carte
    if (detailMapRenderer.map && itinerary.steps) { // V44: Basé sur les étapes
        if (currentDetailRouteLayer) {
            detailMapRenderer.map.removeLayer(currentDetailRouteLayer);
            currentDetailRouteLayer = null;
        }
        // ✅ V46: Vider les anciens marqueurs
        if (currentDetailMarkerLayer) {
            currentDetailMarkerLayer.clearLayers();
        }
        
        const stepLayers = [];

        itinerary.steps.forEach(step => {
            const style = getLeafletStyleForStep(step);

            // ✅ V45: Gérer les polylines agrégées (marche/vélo) ou simples (bus)
            const polylinesToDraw = (step.type === 'BUS') 
                ? [step.polyline] // Le bus a une seule polyline
                : step.polylines;  // La marche/vélo ont un tableau de polylines

            if (!polylinesToDraw) return;
            
            polylinesToDraw.forEach(polyline => {
                if (!polyline || !polyline.encodedPolyline) {
                    console.warn("Étape (détail) sans polyline:", step);
                    return;
                }

                // ✅ FIX V42: Décoder la polyline encodée de Google
                let coordinates;
                try {
                    const decoded = decodePolyline(polyline.encodedPolyline);
                    coordinates = {
                        type: "LineString",
                        coordinates: decoded.map(coord => [coord[1], coord[0]]) // [lng, lat]
                    };
                } catch (e) {
                    console.error("Erreur décodage polyline d'étape (détail):", e, polyline.encodedPolyline);
                    return;
                }

                if (coordinates) {
                    const stepLayer = L.geoJSON(coordinates, {
                        style: style // Utiliser le style dynamique de l'étape
                    });
                    stepLayers.push(stepLayer);
                }
            });
        });

        if (stepLayers.length > 0) {
            // Créer un groupe avec toutes les couches d'étapes
            currentDetailRouteLayer = L.featureGroup(stepLayers).addTo(detailMapRenderer.map);
            
            // ✅ V46: Ajouter les marqueurs
            addItineraryMarkers(itinerary, detailMapRenderer.map, currentDetailMarkerLayer);

            // ✅ V48 (MODIFICATION IMPLÉMENTÉE): La ligne fitBounds est SUPPRIMÉE d'ici
        }
    }
    
    // ✅ V48 (MODIFICATION IMPLÉMENTÉE): 
    // On retourne la couche qui vient d'être créée
    return currentDetailRouteLayer;
}


/**
 * Helper pour formater le temps ISO de Google en HH:MM
 */
function formatGoogleTime(isoTime) {
    if (!isoTime) return "--:--";
    try {
        const date = new Date(isoTime);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    } catch (e) {
        return "--:--";
    }
}

/**
 * Helper pour formater la durée de Google (ex: "1800s") en "30 min"
 */
function formatGoogleDuration(durationString) {
    if (!durationString) return "";
    try {
        // ✅ V46: Gérer le cas où la durée est déjà 0 ou invalide
        const seconds = parseInt(durationString.slice(0, -1));
        if (isNaN(seconds) || seconds < 1) return ""; // Ne pas afficher "0 min"
        
        const minutes = Math.round(seconds / 60);
        if (minutes < 1) return "< 1 min";
        if (minutes > 60) {
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            return m === 0 ? `${h}h` : `${h}h ${m}min`; // V46.1: Précision
        }
        return `${minutes} min`;
    } catch (e) {
        return "";
    }
}

/**
 * NOUVEAU HELPER
 * Helper pour parser la durée de Google (ex: "1800s") en nombre (1800)
 */
function parseGoogleDuration(durationString) {
    if (!durationString) return 0;
    try {
        return parseInt(durationString.slice(0, -1)) || 0;
    } catch (e) {
        return 0;
    }
}


// --- Fonctions de l'application (logique métier GTFS) ---

function renderInfoTraficCard() {
    if (!dataManager || !infoTraficList) return;
    infoTraficList.innerHTML = '';
    let alertCount = 0;
    
    const groupedRoutes = {
        'majeures': { name: 'Lignes majeures', routes: [] },
        'express': { name: 'Lignes express', routes: [] },
        'quartier': { name: 'Lignes de quartier', routes: [] },
        'navettes': { name: 'Navettes', routes: [] }
    };
    const allowedCategories = ['majeures', 'express', 'quartier', 'navettes'];

    dataManager.routes.forEach(route => {
        const category = getCategoryForRoute(route.route_short_name);
        if (allowedCategories.includes(category)) {
            groupedRoutes[category].routes.push(route);
        }
    });

    for (const [categoryId, categoryData] of Object.entries(groupedRoutes)) {
        if (categoryData.routes.length === 0) continue;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'trafic-group';
        
        let badgesHtml = '';
        categoryData.routes.sort((a, b) => { 
             return a.route_short_name.localeCompare(b.route_short_name, undefined, {numeric: true});
        });

        categoryData.routes.forEach(route => {
            const state = lineStatuses[route.route_id] || { status: 'normal', message: '' };
            const routeColor = route.route_color ? `#${route.route_color}` : '#3388ff';
            const textColor = route.route_text_color ? `#${route.route_text_color}` : '#ffffff';
            let statusIcon = '';
            let statusColor = 'transparent'; 
            if (state.status !== 'normal') {
                alertCount++;
                if (state.status === 'annulation') statusColor = 'var(--color-red)';
                else if (state.status === 'retard') statusColor = 'var(--color-yellow)';
                else statusColor = 'var(--color-orange)';
                statusIcon = `<div class="status-indicator-triangle type-${state.status}" style="border-bottom-color: ${statusColor};"></div>`;
            }
            badgesHtml += `
                <div class="trafic-badge-item status-${state.status}">
                    <span class="line-badge" style="background-color: ${routeColor}; color: ${textColor};">
                        ${route.route_short_name}
                    </span>
                    ${statusIcon}
                </div>
            `;
        });

        groupDiv.innerHTML = `
            <h4>${categoryData.name}</h4>
            <div class="trafic-badge-list">
                ${badgesHtml}
            </div>
        `;
        infoTraficList.appendChild(groupDiv);
    }
    infoTraficCount.textContent = alertCount;
    infoTraficCount.classList.toggle('hidden', alertCount === 0);
}

function buildFicheHoraireList() {
    if (!dataManager || !ficheHoraireContainer) return;
    ficheHoraireContainer.innerHTML = '';

    const groupedRoutes = {
        'Lignes A, B, C et D': [],
        'Lignes e': [],
        'Lignes K': [],
        'Lignes N': [],
        'Lignes R': [],
    };

    dataManager.routes.forEach(route => {
        const name = route.route_short_name;
        if (['A', 'B', 'C', 'D'].includes(name)) groupedRoutes['Lignes A, B, C et D'].push(route);
        else if (name.startsWith('e')) groupedRoutes['Lignes e'].push(route);
        else if (name.startsWith('K')) groupedRoutes['Lignes K'].push(route);
        else if (name.startsWith('N')) groupedRoutes['Lignes N'].push(route);
        else if (name.startsWith('R')) groupedRoutes['Lignes R'].push(route);
    });

    for (const [groupName, routes] of Object.entries(groupedRoutes)) {
        if (routes.length === 0) continue;
        const accordionGroup = document.createElement('div');
        accordionGroup.className = 'accordion-group';
        let linksHtml = '';
        
        if (groupName === 'Lignes R') {
            linksHtml = `
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R1_R2_R3_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R1, R2, R3 La Feuilleraie <> ESAT / Les Gourdoux <> Trélissac Les Garennes / Les Pinots <> P+R Aquacap</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R4_R5_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R4, R5 Route de Payenché <> Collège Jean Moulin / Les Mondines / Clément Laval <> Collège Jean Moulin</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R6_R7_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R6, R7 Maison des Compagnons <> Gour de l’Arche poste / Le Charpe <> Gour de l’Arche poste</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R8_R9_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R8, R9 Jaunour <> Boulazac centre commercial / Stèle de Lesparat <> Place du 8 mai</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R10_R11_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R10, R11 Notre Dame de Sanilhac poste <> Centre de la communication / Héliodore <> Place du 8 mai</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R12_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Ligne R12 Le Change <> Boulazac centre commercial</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R13_R14_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Lignes R13, R14 Coursac <> Razac sur l’Isle / La Chapelle Gonaguet <>Razac sur l’Isle</a>
                <a href="/data/fichehoraire/grandperigueux_fiche_horaires_ligne_R15_sept_2025.pdf" target="_blank" rel="noopener noreferrer">Ligne R15 Boulazac Isle Manoire <> Halte ferroviaire Niversac</a>
            `;
        } else {
            routes.sort((a, b) => a.route_short_name.localeCompare(b.route_short_name, undefined, {numeric: true}));
            routes.forEach(route => {
                let pdfName = PDF_FILENAME_MAP[route.route_short_name];
                let pdfPath = pdfName ? `/data/fichehoraire/${pdfName}` : '#';
                if (!pdfName) console.warn(`PDF non mappé pour ${route.route_short_name}.`);
                const longName = ROUTE_LONG_NAME_MAP[route.route_short_name] || (route.route_long_name ? route.route_long_name.replace(/<->/g, '<=>') : '');
                const displayName = `Ligne ${route.route_short_name} ${longName}`.trim();
                linksHtml += `<a href="${pdfPath}" target="_blank" rel="noopener noreferrer">${displayName}</a>`;
            });
        }

        if (linksHtml) {
            accordionGroup.innerHTML = `
                <details>
                    <summary>${groupName}</summary>
                    <div class="accordion-content">
                        <div class="accordion-content-inner">
                            ${linksHtml}
                        </div>
                    </div>
                </details>
            `;
            ficheHoraireContainer.appendChild(accordionGroup);
        }
    }
    
    const allDetails = document.querySelectorAll('#fiche-horaire-container details');
    allDetails.forEach(details => {
        details.addEventListener('toggle', (event) => {
            if (event.target.open) {
                allDetails.forEach(d => {
                    if (d !== event.target && d.open) {
                        d.open = false;
                    }
                });
            }
        });
    });
}

function renderAlertBanner() {
    let alerts = [];
    let firstAlertStatus = 'normal';
    
    if (Object.keys(lineStatuses).length === 0) {
        alertBanner.classList.add('hidden');
        return;
    }
    
    for (const route_id in lineStatuses) {
        const state = lineStatuses[route_id];
        if (state.status !== 'normal') {
            const route = dataManager.getRoute(route_id);
            if (route) { 
                alerts.push({
                    name: route.route_short_name,
                    status: state.status,
                    message: state.message
                });
            }
        }
    }

    if (alerts.length === 0) {
        alertBanner.classList.add('hidden');
        return;
    }

    if (alerts.some(a => a.status === 'annulation')) firstAlertStatus = 'annulation';
    else if (alerts.some(a => a.status === 'perturbation')) firstAlertStatus = 'perturbation';
    else firstAlertStatus = 'retard';
    
    alertBanner.className = `type-${firstAlertStatus}`;
    let alertIcon = ICONS.alertBanner(firstAlertStatus);
    let alertText = alerts.map(a => `<strong>Ligne ${a.name}</strong>`).join(', ');
    alertBannerContent.innerHTML = `${alertIcon} <strong>Infos Trafic:</strong> ${alertText}`;
    alertBanner.classList.remove('hidden');
}


/**
 * Logique de changement de VUE
 */
function showMapView() {
    dashboardContainer.classList.add('hidden');
    itineraryResultsContainer.classList.add('hidden');
    itineraryDetailContainer.classList.add('hidden'); // V33
    mapContainer.classList.remove('hidden');
    document.body.classList.add('view-is-locked'); 
    if (mapRenderer && mapRenderer.map) {
        mapRenderer.map.invalidateSize();
    }
}

function showDashboardHall() {
    dashboardContainer.classList.remove('hidden');
    itineraryResultsContainer.classList.add('hidden');
    itineraryDetailContainer.classList.add('hidden'); // V33
    mapContainer.classList.add('hidden');
    document.body.classList.remove('view-is-locked'); 
    
    if (dataManager) { 
        renderAlertBanner(); 
    }
    dashboardContentView.classList.remove('view-is-active');
    dashboardHall.classList.add('view-is-active');
    document.querySelectorAll('#dashboard-content-view .card').forEach(card => {
        card.classList.remove('view-active');
    });
}

function showResultsView() {
    dashboardContainer.classList.add('hidden');
    itineraryResultsContainer.classList.remove('hidden');
    itineraryDetailContainer.classList.add('hidden'); // V33
    mapContainer.classList.add('hidden');
    document.body.classList.add('view-is-locked'); // Verrouille le scroll

    if (resultsListContainer) {
        resultsListContainer.innerHTML = '<p class="results-message">Recherche d\'itinéraire en cours...</p>';
    }
    
    // *** NOUVEAU V35: Invalide la carte PC ***
    if (resultsMapRenderer && resultsMapRenderer.map) {
        setTimeout(() => {
             resultsMapRenderer.map.invalidateSize();
        }, 10);
    }
}

/**
 * *** MODIFIÉ V48 (Zoom Mobile) ***
 * Accepte la couche du trajet et gère le zoom au bon moment.
 */
function showDetailView(routeLayer) { // ✅ V48: Accepte routeLayer en argument
    itineraryDetailContainer.classList.remove('hidden');
    
    // Invalide la carte des détails MAINTENANT
    if (detailMapRenderer && detailMapRenderer.map) {
        detailMapRenderer.map.invalidateSize();
    }

    // Force l'animation
    setTimeout(() => {
        itineraryDetailContainer.classList.add('is-active');
        
        // ✅ V48 (MODIFICATION IMPLÉMENTÉE):
        // Zoome sur le trajet APRÈS que la carte soit visible et ait une taille
        if (routeLayer && detailMapRenderer.map) {
            try {
                const bounds = routeLayer.getBounds();
                if (bounds.isValid()) {
                    // Ce zoom se produit maintenant au bon moment
                    detailMapRenderer.map.fitBounds(bounds, { padding: [20, 20] });
                }
            } catch (e) {
                console.error("Erreur lors du fitBounds sur la carte détail:", e);
            }
        }
        
    }, 10); // 10ms (Juste pour démarrer l'animation CSS)
}


// *** NOUVELLE FONCTION V33 ***
function hideDetailView() {
    itineraryDetailContainer.classList.remove('is-active');
    // Cache après la fin de la transition
    setTimeout(() => {
        itineraryDetailContainer.classList.add('hidden');
        // Vider le contenu pour la prochaine fois
        detailPanelContent.innerHTML = '';
        if (currentDetailRouteLayer) {
            detailMapRenderer.map.removeLayer(currentDetailRouteLayer);
            currentDetailRouteLayer = null;
        }
        // ✅ V46: Vider aussi les marqueurs
        if (currentDetailMarkerLayer) {
            currentDetailMarkerLayer.clearLayers();
        }
    }, 300); // 300ms (correspond au CSS)
}


function showDashboardView(viewName) {
    dashboardHall.classList.remove('view-is-active');
    dashboardContentView.classList.add('view-is-active');

    // V27/V28 : On scrolle le body, pas le dashboard-main
    window.scrollTo({ top: 0, behavior: 'auto' });

    document.querySelectorAll('#dashboard-content-view .card').forEach(card => {
        card.classList.remove('view-active');
    });

    const activeCard = document.getElementById(viewName);
    if (activeCard) {
        setTimeout(() => {
            activeCard.classList.add('view-active');
        }, 50);
    }
}


// --- Fonctions de l'application (logique métier GTFS) ---

function checkAndSetupTimeMode() {
    timeManager.setMode('real');
    timeManager.play();
    console.log('⏰ Mode TEMPS RÉEL activé.');
}

function initializeRouteFilter() {
    const routeCheckboxesContainer = document.getElementById('route-checkboxes');
    if (!routeCheckboxesContainer || !dataManager) return;

    routeCheckboxesContainer.innerHTML = '';
    visibleRoutes.clear();
    const routesByCategory = {};
    Object.keys(LINE_CATEGORIES).forEach(cat => { routesByCategory[cat] = []; });
    routesByCategory['autres'] = [];
    
    dataManager.routes.forEach(route => {
        visibleRoutes.add(route.route_id);
        const category = getCategoryForRoute(route.route_short_name);
        routesByCategory[category].push(route);
    });
    Object.values(routesByCategory).forEach(routes => {
        routes.sort((a, b) => a.route_short_name.localeCompare(b.route_short_name, undefined, {numeric: true}));
    });

    Object.entries(LINE_CATEGORIES).forEach(([categoryId, categoryInfo]) => {
        const routes = routesByCategory[categoryId];
        
        // ✅ V57.1 (CORRECTION BUG) : 'continue' remplacé par 'return'
        if (routes.length === 0) return; 

        const categoryHeader = document.createElement('div');
        categoryHeader.className = 'category-header';
        categoryHeader.innerHTML = `
            <div class="category-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="${categoryInfo.color}"><circle cx="12" cy="12" r="10"/></svg>
                <strong>${categoryInfo.name}</strong>
                <span class="category-count">(${routes.length})</span>
            </div>
            <div class="category-actions">
                <button class="btn-category-action" data-category="${categoryId}" data-action="select">Tous</button>
                <button class="btn-category-action" data-category="${categoryId}" data-action="deselect">Aucun</button>
            </div>`;
        routeCheckboxesContainer.appendChild(categoryHeader);
        
        const categoryContainer = document.createElement('div');
        categoryContainer.className = 'category-routes';
        categoryContainer.id = `category-${categoryId}`;
        routes.forEach(route => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'route-checkbox-item';
            
            // *** CORRECTION V30 (BUG ##) ***
            // Le '#' est retiré des variables. Il est appliqué
            // directement et uniquement dans la chaîne innerHTML.
            const routeColor = route.route_color ? route.route_color : '3388ff';
            const textColor = route.route_text_color ? route.route_text_color : 'ffffff';
            
            itemDiv.innerHTML = `
                <input type="checkbox" id="route-${route.route_id}" data-category="${categoryId}" checked>
                <div class="route-badge" style="background-color: #${routeColor}; color: #${textColor};">
                    ${route.route_short_name || route.route_id}
                </div>
                <span class="route-name">${route.route_long_name || route.route_short_name || route.route_id}</span>
            `;
            
            itemDiv.querySelector('input[type="checkbox"]').addEventListener('change', handleRouteFilterChange);
            itemDiv.addEventListener('mouseenter', () => mapRenderer.highlightRoute(route.route_id, true));
            itemDiv.addEventListener('mouseleave', () => mapRenderer.highlightRoute(route.route_id, false));
            itemDiv.addEventListener('click', (e) => {
                if (e.target.type === 'checkbox') return;
                mapRenderer.zoomToRoute(route.route_id);
            });
            categoryContainer.appendChild(itemDiv);
        });
        routeCheckboxesContainer.appendChild(categoryContainer);
    });

    document.querySelectorAll('.btn-category-action').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const category = e.target.dataset.category;
            const action = e.target.dataset.action;
            handleCategoryAction(category, action);
        });
    });
}

function handleCategoryAction(category, action) {
    const checkboxes = document.querySelectorAll(`input[data-category="${category}"]`);
    checkboxes.forEach(checkbox => { checkbox.checked = (action === 'select'); });
    handleRouteFilterChange();
}

function handleRouteFilterChange() {
    if (!dataManager) return;
    visibleRoutes.clear();
    dataManager.routes.forEach(route => {
        const checkbox = document.getElementById(`route-${route.route_id}`);
        if (checkbox && checkbox.checked) { visibleRoutes.add(route.route_id); }
    });
    if (dataManager.geoJson) {
        mapRenderer.displayMultiColorRoutes(dataManager.geoJson, dataManager, visibleRoutes);
    }
    updateData();
}

function handleSearchInput(e) {
    const query = e.target.value.toLowerCase();
    if (query.length < 2) {
        searchResultsContainer.classList.add('hidden');
        searchResultsContainer.innerHTML = '';
        return;
    }
    if (!dataManager) return;
    const matches = dataManager.masterStops
        .filter(stop => stop.stop_name.toLowerCase().includes(query))
        .slice(0, 10); 
    displaySearchResults(matches, query);
}

function displaySearchResults(stops, query) {
    searchResultsContainer.innerHTML = '';
    if (stops.length === 0) {
        searchResultsContainer.innerHTML = `<div class="search-result-item">Aucun arrêt trouvé.</div>`;
        searchResultsContainer.classList.remove('hidden');
        return;
    }
    stops.forEach(stop => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        const regex = new RegExp(`(${query})`, 'gi');
        item.innerHTML = stop.stop_name.replace(regex, '<strong>$1</strong>');
        item.addEventListener('click', () => onSearchResultClick(stop));
        searchResultsContainer.appendChild(item);
    });
    searchResultsContainer.classList.remove('hidden');
}

function onSearchResultClick(stop) {
    showMapView(); 
    if (mapRenderer) {
        mapRenderer.zoomToStop(stop);
        mapRenderer.onStopClick(stop);
    }
    searchBar.value = stop.stop_name;
    searchResultsContainer.classList.add('hidden');
}

/**
 * Fonction de mise à jour principale (pour la carte temps réel)
 */
function updateData() {
    if (!timeManager || !tripScheduler || !busPositionCalculator || !mapRenderer) {
        return;
    }

    const currentSeconds = timeManager.getCurrentSeconds();
    const currentDate = timeManager.getCurrentDate(); 
    
    updateClock(currentSeconds);
    
    const activeBuses = tripScheduler.getActiveTrips(currentSeconds, currentDate);
    const allBusesWithPositions = busPositionCalculator.calculateAllPositions(activeBuses);

    allBusesWithPositions.forEach(bus => {
        if (bus && bus.route) {
            const routeId = bus.route.route_id;
            bus.currentStatus = (lineStatuses[routeId] && lineStatuses[routeId].status) 
                                ? lineStatuses[routeId].status 
                                : 'normal';
        }
    });
    
    const visibleBuses = allBusesWithPositions
        .filter(bus => bus !== null)
        .filter(bus => bus.route && visibleRoutes.has(bus.route.route_id)); 
    
    mapRenderer.updateBusMarkers(visibleBuses, tripScheduler, currentSeconds);
    updateBusCount(visibleBuses.length, visibleBuses.length);
}

function updateClock(seconds) {
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const timeString = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    
    const currentTimeEl = document.getElementById('current-time');
    if (currentTimeEl) currentTimeEl.textContent = timeString;
    
    const now = new Date();
    const dateString = now.toLocaleDateString('fr-FR', { 
        weekday: 'short', 
        day: 'numeric', 
        month: 'short' 
    });
    const dateIndicatorEl = document.getElementById('date-indicator');
    if (dateIndicatorEl) dateIndicatorEl.textContent = dateString;
}

function updateBusCount(visible, total) {
    const busCountElement = document.getElementById('bus-count');
    if (busCountElement) {
        busCountElement.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10"/>
            </svg>
            ${visible} bus
        `;
    }
}

function updateDataStatus(message, status = '') {
    const statusElement = document.getElementById('data-status');
    if (statusElement) {
        statusElement.className = status;
        statusElement.textContent = message;
    }
}

// Initialise l'application
initializeApp().then(() => {
    // Le Hall est déjà visible par défaut
});

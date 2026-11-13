// A competition design drawn as a modern street map, from the layers made by
// georef/mapstyle.py (roads classed by repair.py, the railway, water, parks,
// buildings and the plan's own place names).  ?plan=<id> picks the design; No. 10 by
// default.

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cogProtocol } from './cog.js';

maplibregl.addProtocol('cog', cogProtocol);

const PLAN = new URLSearchParams(location.search).get('plan') || 'design-10-griffiths-coulter-caswell';
const DATA = `/data/styled/${PLAN}`;
const START_HASH = location.hash;
const FONT = ['Open Sans Semibold'];

// Road classes, minor to major: [class, min zoom, casing colour, fill colour, widths by zoom].
const ROADS = [
    ['lane', 14, '#dfe1e5', '#ffffff', [14, 0.6, 16, 3, 18, 9, 20, 30]],
    ['street', 12, '#d3d6db', '#ffffff', [12, 0.7, 14, 1.8, 16, 6, 18, 17, 20, 60]],
    ['avenue', 11, '#ecc65a', '#fff3c4', [11, 1, 13, 2.4, 16, 9, 18, 26, 20, 95]],
    ['boulevard', 10, '#f1c24f', '#fde293', [10, 1.2, 12, 2.8, 16, 12, 18, 36, 20, 130]],
];
const widths = (stops, extra = 0) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops.map((v, i) => (i % 2 ? v + extra : v))];

const sources = {
    satellite: {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
    },
};
for (const k of ['extent', 'landuse', 'water', 'buildings', 'roads', 'labels', 'railways', 'bridges', 'pois']) {
    sources[k] = { type: 'geojson', data: `${DATA}/${k}.geojson` };
}
sources.roads.attribution = 'Streets traced from the 1911 competition drawings, <a href="https://nla.gov.au/">National Library of Australia</a>';

const roadLayers = [];
for (const [cls, minzoom, casing] of ROADS) {
    const stops = ROADS.find((r) => r[0] === cls)[4];
    roadLayers.push({
        id: `${cls}-casing`, type: 'line', source: 'roads', minzoom, filter: ['==', ['get', 'class'], cls],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': casing, 'line-width': widths(stops, 1.5) },
    });
}
for (const [cls, minzoom, , fill] of ROADS) {
    const stops = ROADS.find((r) => r[0] === cls)[4];
    roadLayers.push({
        id: `${cls}-fill`, type: 'line', source: 'roads', minzoom, filter: ['==', ['get', 'class'], cls],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': fill, 'line-width': widths(stops) },
    });
}

// A planted median down the middle of an avenue: a green strip a third of
// the road's width, from zoom 14.
roadLayers.push({
    id: 'median', type: 'line', source: 'roads', minzoom: 14, filter: ['==', ['get', 'median'], 'planted'],
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': '#a8d5a2', 'line-width': widths([14, 1, 16, 4, 18, 12, 20, 44]) },
});

// Bridges: the road again, over the water, with a darker edge.
const bridgeLayers = [];
for (const [cls, minzoom, , fill] of ROADS) {
    const stops = ROADS.find((r) => r[0] === cls)[4];
    bridgeLayers.push(
        {
            id: `bridge-${cls}-casing`, type: 'line', source: 'bridges', minzoom,
            filter: ['all', ['==', ['get', 'kind'], 'road'], ['==', ['get', 'class'], cls]],
            layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#9aa0a6', 'line-width': widths(stops, 3) },
        },
        {
            id: `bridge-${cls}-fill`, type: 'line', source: 'bridges', minzoom,
            filter: ['all', ['==', ['get', 'kind'], 'road'], ['==', ['get', 'class'], cls]],
            layout: { 'line-cap': 'butt' }, paint: { 'line-color': fill, 'line-width': widths(stops) },
        },
    );
}

// The railway: a grey line with white ties, in the Google manner.
const railWidth = (k) => ['interpolate', ['linear'], ['zoom'], 11, 1 * k, 15, 2.5 * k, 18, 4 * k];
const railLayers = [
    { id: 'rail-bridge', type: 'line', source: 'bridges', filter: ['==', ['get', 'kind'], 'rail'], paint: { 'line-color': '#80868b', 'line-width': railWidth(3) } },
    { id: 'rail', type: 'line', source: 'railways', paint: { 'line-color': '#8a8f96', 'line-width': railWidth(1.4) } },
    {
        id: 'rail-ties', type: 'line', source: 'railways', minzoom: 13,
        paint: { 'line-color': '#ffffff', 'line-width': railWidth(0.7), 'line-dasharray': [2, 3] },
    },
];

// Named public buildings: a small dot and the name from the plan's key.
const poiLayers = [
    {
        id: 'poi', type: 'circle', source: 'pois', minzoom: 14,
        paint: { 'circle-radius': 4, 'circle-color': ['match', ['get', 'kind'], 'station', '#5f6368', 'hotel', '#e8710a', '#7b61c9'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 },
    },
    {
        id: 'poi-label', type: 'symbol', source: 'pois', minzoom: 14.5,
        layout: {
            'text-field': ['get', 'name'], 'text-font': FONT, 'text-size': 11.5, 'text-anchor': 'top', 'text-offset': [0, 0.6],
            'text-max-width': 9, 'text-optional': true,
        },
        paint: { 'text-color': ['match', ['get', 'kind'], 'hotel', '#b45309', '#5b4bab'], 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
    },
];

const label = (kind, colour, halo, size) => ({
    id: `label-${kind}`, type: 'symbol', source: 'labels', filter: ['==', ['get', 'kind'], kind],
    layout: {
        'text-field': ['get', 'name'], 'text-font': FONT,
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, size - 2, 16, size + 3],
        'text-max-width': 8, 'text-letter-spacing': kind === 'water' ? 0.15 : 0.02,
    },
    paint: { 'text-color': colour, 'text-halo-color': halo, 'text-halo-width': 1.4 },
});

const map = new maplibregl.Map({
    container: 'map',
    center: [149.125, -35.297],
    zoom: 13.5,
    maxZoom: 20,
    hash: true,
    style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources,
        layers: [
            { id: 'background', type: 'background', paint: { 'background-color': '#e6eedf' } },
            { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
            { id: 'extent', type: 'fill', source: 'extent', paint: { 'fill-color': '#f1f2ee', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 1, 15, 1] } },
            { id: 'urban', type: 'fill', source: 'landuse', filter: ['==', ['get', 'kind'], 'urban'], paint: { 'fill-color': '#ecebe6' } },
            { id: 'park', type: 'fill', source: 'landuse', filter: ['==', ['get', 'kind'], 'park'], paint: { 'fill-color': '#c8e6c4' } },
            { id: 'water', type: 'fill', source: 'water', paint: { 'fill-color': '#aadaff' } },
            { id: 'water-edge', type: 'line', source: 'water', paint: { 'line-color': '#94cdf7', 'line-width': 1 } },
            {
                id: 'buildings', type: 'fill', source: 'buildings', minzoom: 14,
                paint: { 'fill-color': '#dedbd7', 'fill-outline-color': '#cbc8c3', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15, 1] },
            },
            ...roadLayers,
            ...bridgeLayers,
            ...railLayers,
            label('water', '#3a78c2', '#e3f2ff', 13),
            label('park', '#2f7a3b', '#f2fbf0', 12),
            label('place', '#5f6368', '#ffffff', 12),
            ...poiLayers,
        ],
    },
});

map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

map.on('load', async () => {
    const [plans, streets] = await Promise.all([
        fetch('/data/plans.json').then((r) => r.json()),
        fetch('/data/streets.json').then((r) => r.json()).catch(() => []),
    ]);
    const plan = plans.find((p) => p.id === PLAN);
    const meta = streets.find((s) => s.id === PLAN);
    if (meta) document.getElementById('subtitle').textContent = meta.label;
    if (plan) {
        map.addSource('plan', { type: 'raster', url: 'cog://' + location.origin + plan.cog, tileSize: 512 });
        // The drawing sits above the map and fades in with the slider.
        map.addLayer({ id: 'plan', type: 'raster', source: 'plan', paint: { 'raster-opacity': 0, 'raster-resampling': 'linear' } }, 'label-water');
    }
    document.getElementById('plan-opacity').addEventListener('input', (e) => {
        if (map.getLayer('plan')) map.setPaintProperty('plan', 'raster-opacity', Number(e.target.value));
    });
    // Before and after repair.py: swap the roads' data.
    document.getElementById('as-traced').addEventListener('change', (e) => {
        map.getSource('roads').setData(`${DATA}/${e.target.checked ? 'roads-raw' : 'roads'}.geojson`);
    });
    document.getElementById('satellite').addEventListener('change', (e) => {
        const on = e.target.checked;
        map.setLayoutProperty('satellite', 'visibility', on ? 'visible' : 'none');
        for (const id of ['extent', 'urban', 'park', 'water', 'water-edge', 'buildings']) {
            map.setLayoutProperty(id, 'visibility', on ? 'none' : 'visible');
        }
    });
    if (!START_HASH) {
        const fc = await (await fetch(`${DATA}/extent.geojson`)).json();
        const b = new maplibregl.LngLatBounds();
        fc.features.forEach((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
            .forEach((poly) => poly[0].forEach((c) => b.extend(c))));
        if (!b.isEmpty()) map.fitBounds(b, { padding: { top: 20, bottom: 20, right: 20, left: window.innerWidth > 700 ? 340 : 20 }, duration: 0 });
    }
});

map.on('error', (e) => console.error('map error:', e.error?.message || e.error || e));

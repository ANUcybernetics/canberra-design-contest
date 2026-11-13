// A competition design drawn as a modern street map, from the layers made by
// ../mapstyle.py (roads classed by traced width, water, parks, buildings and
// the plan's own place names).  ?plan=<id> picks the design; No. 10 by
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
    ['avenue', 11, '#c5c9cf', '#ffffff', [11, 1, 13, 2.4, 16, 9, 18, 26, 20, 95]],
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
for (const k of ['extent', 'landuse', 'water', 'buildings', 'roads', 'labels']) {
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
            label('water', '#3a78c2', '#e3f2ff', 13),
            label('park', '#2f7a3b', '#f2fbf0', 12),
            label('place', '#5f6368', '#ffffff', 12),
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

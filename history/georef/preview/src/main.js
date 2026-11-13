// Preview of the georeferenced 1910 contour survey over OpenStreetMap.
// The survey is a Web Mercator COG read in the browser by cog.js (from
// hapmap.app); the grid, sheet outlines and stations are GeoJSON made by
// ../make_web.sh.

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cogProtocol } from './cog.js';

maplibregl.addProtocol('cog', cogProtocol);

const COG = location.origin + '/cog/contour-survey-1910-3857.tif';
// Read before the map starts writing its own position into the hash.
const START_HASH = location.hash;

// Historical aerial photo mosaics from hapmap.app, drawn beneath the survey.
// Each is a Web Mercator COG read straight from hapmap.app (it allows CORS).
// To add one, find its item in https://hapmap.app/browse/ and copy the
// item's `data` asset href.
const GA_CREDIT = 'Photographs © <a href="https://www.ga.gov.au/scientific-topics/national-location-information/historical-aerial-photography">Geoscience Australia</a>, CC BY 4.0, via <a href="https://hapmap.app">hapmap.app</a>';
const HAPMAP = [
    {
        id: 'hap-1926',
        label: '1926 (MAP3584)',
        url: 'https://hapmap.app/web/canberra-1926-map3584-blag-3857.tif',
        browse: 'https://hapmap.app/browse/#/canberra-1926/canberra-1926-map3584-blag-3857/canberra-1926-map3584-blag-3857.json',
    },
    {
        id: 'hap-1945',
        label: '12 March 1945 (MAP1537)',
        url: 'https://hapmap.app/web/canberra-1945-map1537-blag-3857.tif',
        browse: 'https://hapmap.app/browse/#/canberra-1945/collection.json',
    },
];

const map = new maplibregl.Map({
    container: 'map',
    center: [149.125, -35.297],
    zoom: 13.5,
    maxZoom: 20,
    hash: true,
    style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
            osm: {
                type: 'raster',
                tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
                tileSize: 256,
                maxzoom: 19,
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            },
            survey: {
                type: 'raster',
                url: 'cog://' + COG,
                tileSize: 512,
                attribution: '1910 contour survey: <a href="https://nla.gov.au/nla.obj-232175445">National Library of Australia</a>',
            },
            grid: { type: 'geojson', data: '/data/grid.geojson' },
            sheets: { type: 'geojson', data: '/data/sheets.geojson' },
            stations: { type: 'geojson', data: '/data/stations.geojson' },
            ...Object.fromEntries(HAPMAP.map((h) => [h.id, { type: 'raster', url: 'cog://' + h.url, tileSize: 512, attribution: GA_CREDIT }])),
        },
        layers: [
            { id: 'osm', type: 'raster', source: 'osm' },
            ...HAPMAP.map((h) => ({ id: h.id, type: 'raster', source: h.id, layout: { visibility: 'none' } })),
            { id: 'survey', type: 'raster', source: 'survey', paint: { 'raster-opacity': 0.85, 'raster-resampling': 'linear' } },
            {
                id: 'sheets', type: 'line', source: 'sheets', layout: { visibility: 'none' },
                paint: { 'line-color': '#7a3cff', 'line-width': 2, 'line-dasharray': [3, 2] },
            },
            {
                id: 'grid', type: 'line', source: 'grid',
                paint: { 'line-color': '#0077ff', 'line-width': 1, 'line-opacity': 0.7 },
            },
            {
                id: 'stations', type: 'circle', source: 'stations',
                paint: {
                    'circle-radius': 6,
                    'circle-color': ['case', ['to-boolean', ['get', 'used']], '#00a86b', '#e0443e'],
                    'circle-stroke-color': '#fff',
                    'circle-stroke-width': 2,
                },
            },
            {
                id: 'station-labels', type: 'symbol', source: 'stations',
                layout: {
                    'text-field': ['get', 'station'],
                    'text-font': ['Open Sans Semibold'],
                    'text-size': 12,
                    'text-offset': [0, 1.2],
                    'text-anchor': 'top',
                },
                paint: { 'text-color': '#123', 'text-halo-color': '#fff', 'text-halo-width': 1.5 },
            },
        ],
    },
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

// Frame the four sheets on first load, unless the URL already says where.
map.on('load', async () => {
    if (START_HASH) return;
    const fc = await (await fetch('/data/sheets.geojson')).json();
    const b = new maplibregl.LngLatBounds();
    fc.features.forEach((f) => f.geometry.coordinates[0].forEach((c) => b.extend(c)));
    // Leave room for the control panel (left) and the zoom buttons (right).
    const left = window.innerWidth > 700 ? 360 : 20;
    map.fitBounds(b, { padding: { top: 20, bottom: 20, right: 60, left }, duration: 0 });
});

// Controls
const opacity = document.getElementById('opacity');
let lastOpacity = Number(opacity.value);
opacity.addEventListener('input', () => {
    lastOpacity = Number(opacity.value);
    map.setPaintProperty('survey', 'raster-opacity', lastOpacity);
});

function toggle(id, layers) {
    const box = document.getElementById(id);
    box.addEventListener('change', () => {
        layers.forEach((l) => map.setLayoutProperty(l, 'visibility', box.checked ? 'visible' : 'none'));
    });
}
// One checkbox per hapmap layer.
const hapList = document.getElementById('hapmap-layers');
HAPMAP.forEach((h) => {
    const row = document.createElement('label');
    row.className = 'row';
    row.innerHTML = `<input id="${h.id}" type="checkbox"> ${h.label} <a href="${h.browse}" target="_blank" rel="noopener" title="Catalogue record">ⓘ</a>`;
    hapList.appendChild(row);
    toggle(h.id, [h.id]);
});

// The 1912 competition plans, georeferenced onto the same survey grid
// (../warp_plans.py), listed in /data/plans.json by ../make_web.sh.  They sit
// above the 1910 survey and share one opacity slider.
const PLAN_CREDIT = '1912 competition plans: <a href="https://nla.gov.au/">National Library of Australia</a>';
const planOpacity = document.getElementById('plan-opacity');
const planList = document.getElementById('plan-layers');
map.on('load', async () => {
    const plans = await (await fetch('/data/plans.json')).json();
    plans.forEach((p) => {
        map.addSource(p.id, { type: 'raster', url: 'cog://' + location.origin + p.cog, tileSize: 512, attribution: PLAN_CREDIT });
        map.addLayer({
            id: p.id, type: 'raster', source: p.id, layout: { visibility: 'none' },
            paint: { 'raster-opacity': Number(planOpacity.value), 'raster-resampling': 'linear' },
        }, 'sheets');
        const row = document.createElement('label');
        row.className = 'row';
        row.innerHTML = `<input id="${p.id}" type="checkbox"> ${p.label}`;
        planList.appendChild(row);
        toggle(p.id, [p.id]);
    });
    planOpacity.addEventListener('input', () => {
        plans.forEach((p) => map.setPaintProperty(p.id, 'raster-opacity', Number(planOpacity.value)));
    });
});

// Street centrelines traced from each plan (../vectorise.py), listed in
// /data/streets.json by ../make_web.sh.  One colour per design, drawn above
// the plans so they can be checked against the drawing beneath.
const STREET_COLOURS = ['#d7191c', '#2b83ba', '#1a9641', '#7b3294', '#e66101', '#008837', '#c51b7d', '#4d4d4d', '#b8860b', '#0571b0'];
map.on('load', async () => {
    const res = await fetch('/data/streets.json');
    if (!res.ok) return;
    const streets = await res.json();
    const list = document.getElementById('street-layers');
    streets.forEach((s, i) => {
        const id = 'streets-' + s.id;
        map.addSource(id, { type: 'geojson', data: s.geojson });
        map.addLayer({
            id, type: 'line', source: id, layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
            paint: {
                'line-color': STREET_COLOURS[i % STREET_COLOURS.length],
                'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 3],
            },
        }, 'sheets');
        const row = document.createElement('label');
        row.className = 'row';
        row.innerHTML = `<input id="${id}" type="checkbox"> <span style="color:${STREET_COLOURS[i % STREET_COLOURS.length]}">━</span> ${s.label} <small>(${s.km} km)</small>`;
        list.appendChild(row);
        toggle(id, [id]);
        map.on('click', id, (e) => {
            const p = e.features[0].properties;
            new maplibregl.Popup()
                .setLngLat(e.lngLat)
                .setHTML(`<strong>${s.label}</strong><br>Width ${p.width_m} m (${Math.round(p.width_m / 0.3048)} ft)<br>Edge length ${p.length_m} m`)
                .addTo(map);
        });
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    });
});

toggle('grid', ['grid']);
toggle('sheets', ['sheets']);
toggle('stations', ['stations', 'station-labels']);

// Space flicks the survey off and on, for comparing with today.
document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.target.tagName === 'INPUT') return;
    e.preventDefault();
    const now = map.getPaintProperty('survey', 'raster-opacity');
    const next = now > 0 ? 0 : lastOpacity || 0.85;
    map.setPaintProperty('survey', 'raster-opacity', next);
    opacity.value = next;
});

// Station details
map.on('click', 'stations', (e) => {
    const p = e.features[0].properties;
    const used = p.used === true || p.used === 'true';
    new maplibregl.Popup()
        .setLngLat(e.features[0].geometry.coordinates)
        .setHTML(
            `<strong>${p.station}</strong> (Sheet ${p.sheet})<br>` +
            `Register mark: ${p.register_mark} (${p.register_condition.toLowerCase()})<br>` +
            `1910 grid: ${Math.round(p.W).toLocaleString()} ft W, ${Math.round(p.S).toLocaleString()} ft S<br>` +
            `Residual: ${Number(p.resid_m).toFixed(1)} m ${used ? '' : '<em>(check only, not used in fit)</em>'}`,
        )
        .addTo(map);
});
map.on('mouseenter', 'stations', () => { map.getCanvas().style.cursor = 'pointer'; });
map.on('mouseleave', 'stations', () => { map.getCanvas().style.cursor = ''; });

// Surface tile and source errors (e.g. a COG that will not open).
map.on('error', (e) => console.error('map error:', e.error?.message || e.error || e));
map.once('idle', () => console.log('map idle at zoom', map.getZoom().toFixed(2)));

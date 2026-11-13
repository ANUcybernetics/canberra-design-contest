// The streets traced from the 1912 plans (../vectorise.py) over a satellite
// image of Canberra today.  The street layers are listed in
// /data/streets.json and the plan COGs in /data/plans.json, both made by
// ../make_web.sh.

import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { cogProtocol } from './cog.js';

maplibregl.addProtocol('cog', cogProtocol);

const START_HASH = location.hash;
const PLAN_CREDIT = '1912 competition plans: <a href="https://nla.gov.au/">National Library of Australia</a>';
// Bright enough to read on dark imagery.
const COLOURS = ['#ff4d4d', '#4dc3ff', '#7dff4d', '#ff4dff', '#ffb000', '#00ffd0', '#ff8c69', '#ffffff', '#ffe74d', '#b18cff'];
// Shown first: the winning design.
const DEFAULT_ON = 'design-29-griffin-copyB';

// Metres per pixel at zoom 0 at Canberra's latitude, for drawing a street at
// its traced width.
const M_PER_PX_Z0 = (40075016.686 / 512) * Math.cos((-35.3 * Math.PI) / 180);
const trueWidth = ['interpolate', ['exponential', 2], ['zoom'],
    10, ['max', 1, ['/', ['get', 'width_m'], M_PER_PX_Z0 / 2 ** 10]],
    22, ['/', ['get', 'width_m'], M_PER_PX_Z0 / 2 ** 22]];
const thinWidth = ['interpolate', ['linear'], ['zoom'], 11, 1, 16, 2.5, 19, 4];

const map = new maplibregl.Map({
    container: 'map',
    center: [149.125, -35.297],
    zoom: 13.5,
    maxZoom: 20,
    hash: true,
    style: {
        version: 8,
        sources: {
            satellite: {
                type: 'raster',
                tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                maxzoom: 19,
                attribution: 'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, and the GIS User Community',
            },
        },
        layers: [
            { id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-brightness-max': 0.6 } },
        ],
    },
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

document.getElementById('sat-brightness').addEventListener('input', (e) => {
    map.setPaintProperty('satellite', 'raster-brightness-max', Number(e.target.value));
});

map.on('load', async () => {
    const [streets, plans] = await Promise.all([
        fetch('/data/streets.json').then((r) => r.json()),
        fetch('/data/plans.json').then((r) => r.json()),
    ]);
    const cogFor = Object.fromEntries(plans.map((p) => [p.id, p.cog]));
    const list = document.getElementById('street-layers');
    const planOpacity = document.getElementById('plan-opacity');
    const widthBox = document.getElementById('true-width');
    const bounds = new maplibregl.LngLatBounds();

    // Plans first, so every street layer draws above every plan.
    streets.forEach((s) => {
        if (!cogFor[s.id]) return;
        map.addSource('plan-' + s.id, { type: 'raster', url: 'cog://' + location.origin + cogFor[s.id], tileSize: 512, attribution: PLAN_CREDIT });
        map.addLayer({
            id: 'plan-' + s.id, type: 'raster', source: 'plan-' + s.id, layout: { visibility: 'none' },
            paint: { 'raster-opacity': Number(planOpacity.value), 'raster-resampling': 'linear' },
        });
    });

    for (const [i, s] of streets.entries()) {
        const id = 'streets-' + s.id;
        const colour = COLOURS[i % COLOURS.length];
        const on = s.id === DEFAULT_ON;
        const data = await fetch(s.geojson).then((r) => r.json());
        if (on) data.features.forEach((f) => f.geometry.coordinates.forEach((c) => bounds.extend(c)));
        map.addSource(id, { type: 'geojson', data });
        map.addLayer({
            id, type: 'line', source: id,
            layout: { visibility: on ? 'visible' : 'none', 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': colour, 'line-width': thinWidth, 'line-opacity': 0.9 },
        });
        const row = document.createElement('label');
        row.className = 'row';
        row.innerHTML = `<input type="checkbox" ${on ? 'checked' : ''}> <span style="color:${colour};text-shadow:0 0 1px #000">━</span> ${s.label}`;
        const box = row.querySelector('input');
        const show = () => {
            const v = box.checked ? 'visible' : 'none';
            map.setLayoutProperty(id, 'visibility', v);
            if (map.getLayer('plan-' + s.id)) map.setLayoutProperty('plan-' + s.id, 'visibility', v);
        };
        box.addEventListener('change', show);
        show();
        list.appendChild(row);
        map.on('click', id, (e) => {
            const p = e.features[0].properties;
            new maplibregl.Popup()
                .setLngLat(e.lngLat)
                .setHTML(`<strong>${s.label}</strong><br>Width ${p.width_m} m (${Math.round(p.width_m / 0.3048)} ft)<br>Edge length ${p.length_m} m`)
                .addTo(map);
        });
        map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }

    planOpacity.addEventListener('input', () => {
        streets.forEach((s) => {
            if (map.getLayer('plan-' + s.id)) map.setPaintProperty('plan-' + s.id, 'raster-opacity', Number(planOpacity.value));
        });
    });
    widthBox.addEventListener('change', () => {
        streets.forEach((s) => {
            map.setPaintProperty('streets-' + s.id, 'line-width', widthBox.checked ? trueWidth : thinWidth);
            map.setPaintProperty('streets-' + s.id, 'line-opacity', widthBox.checked ? 0.55 : 0.9);
        });
    });

    if (!START_HASH && !bounds.isEmpty()) {
        const left = window.innerWidth > 700 ? 360 : 20;
        map.fitBounds(bounds, { padding: { top: 20, bottom: 20, right: 60, left }, duration: 0 });
    }
});

map.on('error', (e) => console.error('map error:', e.error?.message || e.error || e));

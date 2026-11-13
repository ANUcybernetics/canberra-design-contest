# Plan: putting the other competition maps on the base map

Written 2026-11-13. Covers the three NLA scans in `reference/` (Australian no. 10, French/Agache no. 4, Gummer no. 35) and the re-fit of Gimson. Background and the original reasoning are in `docs/visions-plan.md`.

## The idea

All three scans, and Gimson's plan, are drawn on the **same 1911 contour survey**: same sheet, same grid, same trig stations. So the job isn't to fit four maps to each other. It's to fit the survey sheet to the world once, then fit each scan to the survey through the grid and trig stations it shares.

Today the base map (`prototype/src/base/site.js`) was read by eye from Gimson's 726 px plan. Its hills are 0.35–4.3 km from the real summits, so nothing traced from a new scan will line up with it. **The base has to be made real first**; then every map can go on it.

## Step 1. Fix the world frame

1. Adopt **GDA2020 / MGA zone 55 (EPSG:7855)** for position and **AHD** for height. Keep the scene origin on the Kurrajong (Capital Hill) summit so `x = E − E₀`, `z = −(N − N₀)`; the axes the code uses (x east, z south, metres) don't change.
2. Write the origin constants and a `toWorld(E, N)` / `toMGA(x, z)` pair into `base/site.js`.
3. Decide the vertical datum for `WATER = 0`. Suggested: the 1911 Molonglo level through the centre, so the competition visions keep water at y = 0.

*Done when:* `site.js` states the frame and has the conversion functions; nothing visible changes yet.

## Step 2. A real ground under the base

1. Fetch the Copernicus GLO-30 DEM tile S36 E149 (public, no account) and warp it with `gdalwarp` to EPSG:7855 over a 14 km square round Kurrajong, at 20 m to match `GRID.step`.
2. Export it as a 16-bit height PNG (about 1 MB) in `prototype/assets/dem/`. Put the script in a new `tools/` folder.
3. In `base/terrain.js`, make `natural(x, z)` sample the DEM instead of summing the analytic `HILLS`. Keep the small-scale noise for texture.
4. Undo the modern changes for the 1911 visions with a **"1911 restoration" step**: fill the Lake Burley Griffin basin back to a valley floor (interpolated from the shoreline) and restore Kurrajong's crest where Parliament House is cut into it. The 1911 contours on the scans give the target shape.
5. Rewrite `HILLS` (keep it only for labels) and `PLACES` from real summit coordinates.
6. Re-tune ground colour, scrub bands and bush placement, which are keyed to the toy heights.

*Done when:* the bare vision shows real hills in the right places, and its viewpoints still frame their subjects.

## Step 3. Georeference the survey and each scan

1. **Crop** each scan: remove the NLA slip and colour chart from the two lithographs.
2. In QGIS's Georeferencer, pick control points on each scan: **survey grid intersections** (the grid has its origin at the Ainslie trig station) and **trig stations** (Ainslie, Black Mountain, Kurrajong, Red Hill). Six to ten points per scan.
3. Fit an affine transform from pixels to MGA55 for each and save it as `reference/<id>/georef.json` (control points, transform, residuals). Accept residuals under about 20 m; the Australian sheet is at 1:4,800, twice the scale of the lithographs, and the affine handles that.
4. Do the same for `prototype/assets/gimson_plan.jpg` and save `reference/gimson/georef.json`.
5. Write `tools/plan-image.py`: given a scan and its `georef.json`, write a cropped, north-up minimap image to `prototype/assets/plans/<id>.jpg` plus the `{ img, w, h, ox, oy, scale }` descriptor that `main.js` already understands.

*Done when:* overlaying any two georeferenced scans in QGIS, the river and the trig stations coincide.

## Step 4. Re-digitise the shared 1911 river

1. Trace the 1911 Molonglo centreline (and its banks, if they're legible) from the **Australian sheet**, which is the highest-resolution copy of the survey. Use more points than the current 12.
2. Replace `MOLONGLO_1911` in `base/site.js`.
3. Give `riverChannel` a way to interpolate widths along the line by distance rather than by point index, so a vision can specify widths at a few stations without caring how many points the line has.

*Done when:* the bare vision's river sits in the valley the DEM restoration made for it.

## Step 5. Re-fit Gimson to the real base

1. Transform every coordinate in `visions/gimson/layout.js` through Gimson's `georef.json`. This is a similarity transform, so the design keeps its shape but moves by a few hundred metres.
2. Re-specify his river widths against the new centreline (step 4.3).
3. Re-check the level pads in `FLATTEN`, the viewpoints, and the LOD distances.
4. Swap his minimap to the step 3.5 output.

*Done when:* Gimson renders on the real ground with no buildings floating or buried, and his draw-call and triangle counts are within the budget in `prototype/README.md`.

This is the one step that visibly changes the current build.

## Step 6. Extend the base for what the other maps need

1. **Polygon water** in `base/waterways.js`: a `waterPolygons` model with a signed distance to traced polygons, holes for islands, and an embanked-or-sloping type per edge. Needed for the Australian lake and Gummer's basins.
2. **Water at more than one level**: replace the single infinite plane in `base/water.js` with a mesh per water body, each with its own level, and reflect per level (or fall back to a cheaper reflection for small bodies). Needed for the Australian dam and possibly Gummer's weirs.
3. **A plan-driven city builder** in `base/`: GeoJSON streets with a width class go in; blocks are polygonised from the street network, then houses go along the frontages, with parks, landmarks by type, and avenue planting. Gimson keeps his bespoke ring builder.
4. **Style palettes** for `base/kit.js`: facade colours, roof form, storey heights, cornice weight, chosen per vision.
5. Plan render budget for the denser plans: instanced house archetypes, a far-LOD mass per block, and lower density beyond about 1 km.

## Step 7. Trace and build each entry

Same recipe for each: trace in QGIS to GeoJSON in MGA55 (streets with a width class, blocks, parks, water, landmark points), save to `reference/<id>/trace.geojson`, convert to world coordinates with a tool script into `prototype/src/visions/<id>/layout.js` (or a `.json` it loads), then write `index.js`, `landform.js` and `city.js` and add the vision to `visions/index.js`.

Order:

1. **Gummer (no. 35).** Cleanest linework and out of copyright. Tests the city builder and polygon water (the formal basins). Semi-automatic tracing (threshold and skeletonise, then clean by hand) is worth trying here.
2. **Agache (no. 4).** Water is easy (the existing `riverChannel` at natural width), but tracing is hardest: the contours and sewer lines are the same ink as the streets, so it has to be traced by hand.
3. **Australian (no. 10).** Needs the dam, the lake at flood level with islands, and multi-level water. In copyright until the end of 2026: build it now, but keep it out of any public deployment until 1 January 2027.

*Done when, for each:* the minimap shows the scan, clicking it lands on the matching spot in 3D, and the main streets lie on the traced lines.

## Decisions needed

1. **Datum for y = 0** (step 1.3): the 1911 river level, or the modern lake level at about 556 m AHD?
2. **Who traces, and how**: by hand in QGIS for all three, or try semi-automatic for Gummer first?
3. **The Australian entry**: build privately and publish from 1 January 2027, or ask the NLA now?
4. **Restoration detail** (step 2.4): is an interpolated lake-bed fill good enough, or should the 1911 contours on the scans be digitised for the valley floor?

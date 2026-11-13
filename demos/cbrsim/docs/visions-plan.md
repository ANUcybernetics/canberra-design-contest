# Plan: six Canberras on one base

Status: background. Written 2026-11-08. The map-integration steps are superseded by `PLAN.md` at the repo root.

Target visions: **bare 1911 site** (done, first cut) · **real Canberra** · **Gimson** (done) · **Australian entry** (Griffiths, Coulter & Caswell, competitor 10) · **French entry** (Agache, competitor 4, third prize) · **Gummer entry** (Schaufelberg, Rees & Gummer, competitor 35, commended).

## Where things stand

- `prototype/src/` is now split into `base/`, which is shared, and `visions/<id>/`. `?vision=bare|gimson` and a Vision menu choose between them. Switching keeps the camera where it is, so you can compare visions from the same spot.
- **The Gimson build is byte-for-byte unchanged by the refactor.** I fingerprinted the terrain heights, every mesh batch and all of the roughly 12,400 instanced trees, rocks and props before and after, and they match. Both visions render in headless Chrome with no errors. Gimson runs at about 247 draw calls and 1.13M triangles; the bare site at about 130 draw calls and 0.35M triangles.
- **What the base shares** (`base/site.js`): the world frame (metres, origin on Kurrajong, x east and z south), the hills, the 1911 Molonglo centreline, the natural bush, the sky, light, sound, controls, and the building and tree kit.
- **What a vision owns** is a `landform`, made of three things: a water model, which carves the ground, plus level pads and a ground tint. A vision also owns its `build()`, landmarks, viewpoints and minimap plan. As you predicted, water is the part that cannot be shared. The base asks the vision's water model "how far am I from water, and what does the bed look like here?", so a lake, a canal or a natural river all plug in the same way.
- The NLA scans are in `reference/{australian,french,gummer}/`, each with a `SOURCE.md` covering rights, URLs and a description. I made 12 requests in total, one at a time and at least 3 s apart. Each image came from the NLA's own download route at its 5000 px cap, and robots.txt allows those paths.

## What the three new sources are

| | Australian (no. 10) | French (no. 4, Agache) | Gummer (no. 35) |
|---|---|---|---|
| Object | Hand-coloured **original**, about 1:4,800 | 1913 Lands Dept **lithograph**, about 1:9,600 | 1913 Lands Dept **lithograph**, about 1:9,600 |
| On the 1911 contour survey? | Yes | Yes | Yes |
| Water | Molonglo **dammed** at the west ("DAM", "SPILLWAY") into one large irregular lake along the flood line, with islands | **Natural** meandering river, no lake | Natural upstream; through the centre a **formal channel with long rectangular basins** |
| Plan form | Circuses on Camp Hill, at the station and in the north; numbered public buildings; botanical gardens, racecourse, stadium | Wedge and fan sectors of long avenues; monumental groups on Camp Hill, round Kurrajong and to the south-east | A huge ring boulevard round the north, a second arc to the south-west, radials, a rail and avenue corridor to the south-east |
| Legibility | Very good, and colour helps separate layers | **Poor to fair**: streets crowded by contours and overprinted sewer lines | **Excellent**, cleanly drawn |
| Rights | **In copyright until the end of 2026** (Coulter died 1956) | Out of copyright | Out of copyright |

All three sit on the same survey sheet, with the same cartouche, notes box, grid and trig stations. That shared base map is what makes the whole project feasible.

## Blockers and technical issues, most serious first

1. **Copyright on the Australian entry (a blocker for publishing, not for work).** The NLA permits use for research or study now. Tracing it into a public 3D model is arguably an adaptation, so either keep that vision private until it enters the public domain on 1 Jan 2027, about seven weeks away, or ask the NLA. The date is the NLA's own figure, based on Coulter's death; I haven't checked the death dates of Griffiths and Caswell. This is my reading, not legal advice. Agache and Gummer are clear. The real-Canberra data (OSM, ACT open data) needs attribution: ODbL for OSM and CC BY for ACT data.

2. **Street tracing is most of the work, and nothing automates it well.** Gimson's streets are *procedural* (stylised Sitte rings), not traced. The other entries have to be traced, or the result won't be them. The options, which are your decision (see Decisions):
   - **Hand-trace in QGIS** to GeoJSON (streets with a width class, parks, water, landmark points). This is reliable, and the result can be checked against the scan. It takes many hours per entry, and Agache is the worst.
   - **Semi-automatic**: threshold and skeletonise the scan, then clean it up by hand. This would plausibly work for Gummer, which has clean linework. It will not work for Agache, because the contours and sewer lines are the same ink as the streets. It might work for the Australian entry by separating colours.
   - **Procedural "in the manner of"**, like Gimson's rings: fast, but not faithful.

3. **Water at more than one level.** The renderer has one infinite water plane at y = 0 (`base/water.js`). The Australian dam makes a lake *above* the river downstream of it. Gummer's basins may step at weirs, and real Canberra has Lake Burley Griffin above the downstream Molonglo. The fix is to replace the infinite plane with water meshes per body, each with its own level, generated from the water model. The reflection camera is currently mirrored about y = 0, so it needs one reflection pass per visible level, or a cheaper fallback for the smaller bodies. This is a moderate rendering job, and it is needed by three of the six visions.

4. **A polygon water model is missing.** `base/waterways.js` has only `riverChannel`, a centreline with widths. That fits Agache and the bare site. The Australian lake (which follows the flood-line contour and has islands), Gummer's rectangular basins and Lake Burley Griffin need a `waterPolygons` model: a signed distance to traced polygons, with holes for islands and an edge type (embanked or sloping) per edge. It is small and self-contained.

5. **The shared ground is still a toy, and the frame was set by eye.** The hills and the Molonglo line in `base/site.js` were read from Gimson's small plan (726 px at about 6 m per pixel). **They are not close.** Checked on 2026-11-09 against real summit positions (approximate, from memory), the hill centres are off by 0.35 km (Red Hill) to 1.6 km (Mount Ainslie) and 4.3 km (Mount Majura). That's not good enough for laying four plans over one another, and not good enough for Gimson either. The fix is a real frame (GDA2020 / MGA zone 55, EPSG:7855, heights in AHD) plus a real DEM (Copernicus GLO-30); see `PLAN.md`. All three new scans carry the survey's grid and trig stations, so the fix is:
   - Pick control points on each scan (grid intersections and trig stations: Ainslie is the survey's origin of coordinates) and fit an affine transform from pixels to world metres. Store it as `reference/<id>/georef.json`.
   - **Re-digitise the Molonglo and the hill positions from the Australian sheet**, the highest-resolution copy of the survey.
   - **Re-fit Gimson to the same frame.** His layout coordinates will move by a similarity transform; the design itself doesn't change. *This is the one step that will visibly change the current Gimson build.* Gimson's river widths are also attached point-by-point to the shared centreline. If that line is re-digitised with more points, his widths have to be re-specified, or he keeps his own centreline.
   - Optionally, replace the toy hills with real relief. The 1911 survey contours are on every scan; the red contours on the Australian sheet are clearest. Digitising them gives a true 1911 DEM. Modern LiDAR (ACT and Geoscience Australia ELVIS) is easier but has the lake and 110 years of earthworks in it.

6. **Real Canberra doesn't fit the "1911 ground plus water" model.** The modern ground has been rebuilt: Parliament House is cut into Capital Hill (the old Kurrajong Hill), the lake basin was excavated, and there are road cuttings. That vision needs its landform to *replace* the height field with a DEM, not just carve water into it, so `initTerrain` needs a `height` override hook. The data volume is also a different order: tens of thousands of footprints for the central districts alone. That means extruded footprints with aggressive LOD, limited to the terrain's 14 km square, which is roughly the central basin and not all of Canberra.

7. **The render budget for the denser plans.** Gimson's compact city is already at about 1.1M of the 1.5M-triangle target. Gummer's and the Australian entry's built-up areas look roughly two to three times larger. The mitigations: instanced house archetypes instead of unique merged houses, a far-LOD block mass per city block, and lower density beyond about 1 km. This needs measuring early on the first traced plan.

8. **Architectural style is underdetermined.** The NLA items are plans only, with no elevations. Every building currently uses the one Mediterranean kit. Each vision needs at least a palette and roof type, e.g. Beaux-Arts for Agache and Lutyens-school classicism for Gummer. For the Australian entry, the competition watercolours (NAA A710/20, and the ABC article on Coulter) would help. Without elevations this is informed invention, and the help panel should say so, as Gimson's does.

9. **Smaller items:**
   - Both lithographs carry an NLA slip and a colour chart along the bottom, which need cropping off.
   - The Australian sheet is at twice the scale of the others; the affine fit handles that.
   - The occupancy grid covers the central 8 km. That is enough for the 6.4 km survey sheet, but not for real Canberra at full extent.
   - Start-up builds everything on the main thread, so bigger cities mean a longer "Building the city…" pause.

## Proposed order of work

**Phase 1: georeferenced foundation** (affects all visions; changes Gimson slightly)
1. Choose control points on the three scans and Gimson's plan, then write `georef.json` for each. A small script in a separate tools folder makes cropped, north-up minimap images in `prototype/assets/plans/`.
2. Re-digitise `MOLONGLO_1911` and the `HILLS` positions in `base/site.js` from the Australian sheet.
3. Re-fit Gimson's layout through his georef, and give him his own centreline if needed. Confirm his viewpoints still frame their subjects.
4. Optional: digitise the 1911 contours into a DEM and swap it in for the analytic hills. Every vision inherits it.

**Phase 2: base generalisation**
5. A `waterPolygons` model, plus a per-vision water level.
6. Water meshes per level in place of the single plane, with reflections per level.
7. A **plan-driven city builder** in `base/`: GeoJSON streets with width classes go in. Blocks are polygonised from the street network, then come houses along frontages, parks, landmarks by type and avenue planting. Gimson keeps his bespoke rings; the others use this.
8. Style palettes for the kit: facade colours, roof form, storey heights, cornice weight.
9. A `height` override hook in `initTerrain`, for real Canberra.

**Phase 3: the visions**, in this order:
10. **Gummer.** It has the cleanest drawing and is out of copyright, which makes it the best test of the city builder and of polygon water (its basins).
11. **Agache.** The water is easiest (the existing `riverChannel` at natural width), but the tracing is hardest.
12. **Australian.** Work on it privately now and publish from 1 Jan 2027. It needs the dam, the lake at flood level, the islands and multi-level water.
13. **Real Canberra.** A different pipeline: DEM, OSM and ACT footprints, the lake polygon, and attribution.
14. **Bare site, second pass.** Real relief from step 4, and casuarinas in place of the poplar stand-ins along the river.

## Decisions I need from you

1. **The reference frame.** Should everything move to the 1911 survey's own grid, refitting Gimson so he shifts slightly (I recommend this), or should Gimson's current frame stay with the others fitted to it?
2. **Tracing.** By hand in QGIS (by whom?), semi-automatic for Gummer only, or procedural approximations?
3. **The Australian entry.** Build it privately now and publish in January, or ask the NLA?
4. **Real Canberra.** What year, what extent (central basin only, or wider), and buildings as plain extrusions?
5. **Ground.** Should the 1911 contours be digitised for true relief, or should the toy hills be kept and only repositioned?

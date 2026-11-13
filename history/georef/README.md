# Georeferencing the 1910 contour survey

This folder turns the four sheets of the 1910 *Map of Contour Survey of the Site for the Federal Capital of Australia* into one georeferenced image that drops straight into QGIS.

The result is `output/contour-survey-1910-mga55.tif`, a Cloud-Optimised GeoTIFF in GDA2020 / MGA zone 55 (EPSG:7855) at 0.7 m per pixel.
Beside it, `output/contour-survey-1910-grid.gpkg` holds the 1910 grid lines, the four sheet outlines and the control stations, so you can check the fit for yourself.
Neither file is committed; run the pipeline to make them.

## The survey's own coordinates

The NOTES panel on Sheet 2 says it plainly: *"Trigonometrical Station AINSLIE is the origin of Co-ordinates and the Trigonometrical Meridian has been adopted in the Survey."*
So the map is drawn on a flat grid, in feet, counted west and south of the trig on Mount Ainslie.
Meridians and parallels are ruled every 2,500 feet, and each sheet covers a square of 10,000 feet.

| | 0–10,000 ft west | 10,000–20,000 ft west |
| --- | --- | --- |
| **0–10,000 ft south** | Sheet 2 | Sheet 1 |
| **10,000–20,000 ft south** | Sheet 4 | Sheet 3 |

## How it is tied to the ground

Many of the 1910 trig stations survive in the ACT Government's survey control mark register under their original names.
We found each station's symbol on the scans and matched it to its modern coordinates.
A single similarity transform (shift, rotation and scale) then carries the 1910 grid onto MGA zone 55.

| Station | Sheet | Register mark | Residual (m) |
| --- | --- | --- | --- |
| Ainslie | 2 | AINSLIE | 4.4 |
| Black Mountain | 1 | BLACK MOUNT | 1.6 |
| Vernon (City Hill) | 2 | VERNON | 4.6 |
| Quarry | 3 | QUARRY (now gone) | 1.7 |
| Gap | 3 | GAP | 1.3 |
| Shale | 3 | SHALE | 1.2 |
| Russell | 4 | RUSSELL | 3.5 |
| Rottenbury | 4 | ROTTENBURY (now gone) | 3.5 |
| West of School | 4 | WEST OF SCHOOL | 0.4 |

The nine stations agree to 2.8 m RMS, which is about half a millimetre on the 1:4,800 sheet.
The fitted rotation is −1.41°, of which 1.25° is MGA's grid convergence at Ainslie; the 1910 trigonometrical meridian sits about 0.16° from it.
The fitted scale is 1.0001.

Two checks were left out of the fit.
Red Hill misses by 60 m, because the register only holds an eccentric mark there, not the 1910 station.
St John's Church, Reid, drawn on Sheet 2 as "Church and Spire", lands within a few metres of today's building outline in OpenStreetMap.

## The pipeline

Each step writes small text files to `gcps/`, which are committed; the scans, working files and outputs are not.

1. `extract_sheets.py` unpacks the sheets from the NLA download `nla.obj-232175445.zip`.
   Image 2 in that zip duplicates image 1, so the sheets are images 1, 3, 4 and 5.
2. `detect_grid.py` finds the 25 grid intersections on each sheet by tracing the ruled lines, and writes `gcps/sheetN_grid.csv`.
3. `locate_stations.py` finds each trig symbol by matching a double-ring template, and writes `gcps/stations.csv`.
4. `fit_and_warp.py` fits the transform, warps each sheet through its grid intersections with a thin-plate spline, clips it to its own square (plus the margin out to the neatline on the outer edges), and mosaics the four.
   The fitted parameters and residuals go to `gcps/transform.json`.

To run it all:

```sh
cd history/georef
uv sync
uv run python extract_sheets.py   # finds ../scans/1910-contour-survey/nla.obj-232175445.zip
uv run python detect_grid.py
uv run python locate_stations.py
uv run python fit_and_warp.py
uv run python plans.py          # 1912 plans: find their grids
uv run python warp_plans.py     # ... and warp them
uv run python match_plans.py    # Saarinen's lantern slide
uv run python qa_local.py       # check every plan against the 1910 composite
uv run python vectorise.py      # trace each plan's streets as centrelines
```

To look at it over OpenStreetMap, make the web copy and start the preview:

```sh
./make_web.sh            # Web Mercator COG + GeoJSON for the preview
cd preview && pnpm install && pnpm dev
```

The preview is a small Vite and MapLibre page on port 5180.
It reads the COG straight from the file with `src/cog.js`, the `cog://` protocol from hapmap.app, which draws Web Mercator COGs only; hence the separate EPSG:3857 copy, compressed as WebP with an alpha band.
It has an opacity slider, toggles for the 1910 grid, sheet outlines and stations, and the space bar flicks the old map on and off.
Beneath the survey you can switch on historical aerial photo mosaics from hapmap.app (1926 MAP3584 and 12 March 1945 MAP1537), read straight from hapmap.app's COGs; add more in the `HAPMAP` list in `preview/src/main.js`.
The 1926 mosaic only reaches as far east as about 149.116°E, so it covers just the western quarter of the survey.
To reach it securely across the tailnet, `tailscale serve --bg --https=5181 http://127.0.0.1:5180`, then open `https://<host>.<tailnet>.ts.net:5181/`.

It needs the GDAL command-line tools (`gdal_translate`, `gdalwarp`, `gdalbuildvrt`, `ogr2ogr`) on the path.
Debug overlays for every step land in `work/debug/`.

## The 1912 competition plans

Most of the competition plans were drawn on, or redrawn onto, the 1910 survey, so they carry its 2,500 ft grid.
That means they need no new control points: find a plan's grid, and the transform already fitted for the survey carries it to the ground.

- `plans.py` finds the grid on each plan: all nine meridians and nine parallels, so 81 crossings.
  The lines are faint (often only 35–60 grey levels darker than the paper), so it looks for thin lines darker than the paper on both sides, estimates each sheet's skew, fits an evenly spaced comb of nine lines, and traces each line along its length.
  Comey's sheet is printed on its side and is turned upright first.
- `crossings_sheet.py` makes a contact sheet of all 81 crossings at full resolution, which is the quickest way to see that every one sits on its ruled lines.
- `warp_plans.py` warps each plan with a thin-plate spline through its crossings and writes `output/plans/<plan>-mga55.tif` (for QGIS) and `-3857.tif` (for the preview).
- `match_plans.py` registers Saarinen's lantern slide, a photograph of his original on which no grid survives, by matching its linework block by block against his georeferenced lithograph.
- `qa_local.py` checks each warped plan against the 1910 composite, which no plan was fitted to.
  The plans were drawn on the survey, so their contours and river should sit on the composite's; it phase-correlates the linework in 1.2 km blocks and reports how far apart they are.

| Plan | m/px | Median offset (m) | 90th percentile (m) | Max (m) |
| --- | --- | --- | --- | --- |
| No. 4 Agache (3rd): lithograph, sewerage | 1.04 | 3 | 9 | 20 |
| No. 7 Magonigle (commended): lithograph | 1.04 | 7 | 13 | 18 |
| No. 10 Griffiths, Coulter & Caswell (minority 1st): original | 0.68 | 0 | 3 | 4 |
| No. 18 Saarinen (2nd): lithograph | 1.04 | 2 | 5 | 6 |
| No. 18 Saarinen: lantern slide of original | 1.0 | 4 | 12 | 16 |
| No. 29 Griffin (1st): lithograph, copy A | 1.39 | 4 | 10 | 12 |
| No. 29 Griffin (1st): lithograph, copy B | 0.82 | 6 | 12 | 18 |
| No. 35 Schanfelberg, Rees & Gummer (commended): lithograph | 1.04 | 8 | 16 | 32 |
| No. 37 Bérard: streets plan | 0.81 | 6 | 8 | 18 |
| No. 41 Comey (minority 2nd): lithograph | 1.03 | 2 | 11 | 22 |
| No. 81 Gellerstedt (minority 3rd): lithograph | 1.04 | 4 | 8 | 12 |

Over each whole sheet, every plan lands within one 4 m check pixel of the composite, so no grid was mislabelled.
Locally the lithographs wander a few metres, and up to 20–30 m in places.
The offsets are smooth, not random: the lithographers redrew the survey's contours and river onto a single reduced sheet, and their redrawing departs from the ruled grid by up to a couple of millimetres on paper.
Design No. 10, drawn by its authors directly on a full-size print of the survey, agrees to within 4 m everywhere.
The warp follows the ruled grid, which is the more trustworthy of the two.

Two plans are not done.
Saarinen's "central area" sheet and Agache's public-buildings photograph show no grid and are drawn at a different scale from the lithographs of the same designs, and automatic matching found nothing reliable; they need control points picked by hand.

### Gimson's No. 15: an approximate placement

The Library holds only Gimson's two perspective views, not his plan ([445225](https://catalogue.nla.gov.au/catalog/445225), not digitised), so No. 15 cannot be registered like the others.
`gimson.py` places the lower view, a bird's-eye view of the city, with a single perspective transform from the drawing to the ground, clipped to the foreground; the far shore and the hills cannot be placed.

Every control point is an interpretation, written out in the script.
The working reading is that the view looks south-west from above Reid and Campbell, across the Molonglo reach that ran north-west from the Duntroon loop; the large lake on the left is the loop's flooded flats, the arm running off to the upper left is Jerrabomberra Creek, the stadium stands on the north shore, and the hill with the acropolis-like group is Camp Hill.
The seven points disagree with a single perspective by 162 m RMS (64–272 m), so treat the result as good to a few hundred metres at best, and worse away from the city's near edge.
It is listed in the preview as approximate, and written to `output/plans/design-15-gimson-birdseye-approx-*.tif`.
Gimson's own report, transcribed by John Reps, would settle the reading; a scan of the plan itself would replace this entirely.

## Tracing the streets

`vectorise.py` draws each warped plan's streets as centrelines, with a width on every one, and writes them to `output/streets/<plan>.geojson` and `output/streets-1912.gpkg` (one layer per design, EPSG:7855).
They are automatic first drafts.
They catch most of the streets on flat ground and miss or invent some on steep ground, so treat them as a start for correcting by hand in QGIS, not as a finished map.

It works on the warped plans rather than the original scans, because there every plan already sits on the 1910 composite, and the survey's own ink can be taken out before the streets are looked for.

1. **Find the ink**: anything darker than the local paper.
   On No. 10, whose copy of the survey kept its colours, only the black ink counts, so its red contours and blue water drop out at once.
2. **Take out the survey.**
   The lithographers redrew the survey's contours by hand, and they wander a few metres from the composite; the script measures that wander in 240 m blocks and shifts the composite's ink to match.
   Then it compares lines, not areas: both are thinned to one pixel, and a plan pixel is dropped only if it lies within 3.5 m of a survey line *and runs the same way*.
   A street edge that crosses a contour keeps its pixels at the crossing, which erasing the contours outright did not; on the steep ground, where contours lie 12 m apart, that was the difference between a street grid and nothing.
3. **Mend the designer's lines**: join line ends that face each other across a short gap, and trace straight runs of ink across whatever the survey still breaks.
4. **Find the streets.**
   The paper between the designer's lines holds the streets, but also parks, open country and lots.
   Its skeleton is a graph, and along each edge the distance to the nearest line is half the width of the space.
   An edge is kept if it is 10–64 m wide and its width varies by no more than a quarter along its length; short links across intersections are kept between kept edges, and stubs and isolated fragments are dropped.
   Enclosed pieces of paper smaller than 2,500 m² are lots or courtyards, not streets.
5. **Simplify** each centreline to within about 1.5 pixels and write it out.

Bérard's sheet is different: his streets are pale bands on a dark wash.
For it the script takes a white top-hat (what is brighter than its surroundings and narrower than 80 m), thresholds it by Otsu's method, fills the holes left by lettering and drops the pale specks in the mottled wash.

Saarinen's lantern slide is skipped; his lithograph shows the same design more sharply.
The survey's title block and NOTES panel, Bérard's cartouche and Saarinen's legend are never traced (`EXCLUDE` and the per-plan `exclude` boxes).

| Plan | Centreline (km) | How it looks |
| --- | --- | --- |
| No. 4 Agache: lithograph, sewerage | 310 | The noisiest: the sewer lines and the hatching are traced along with the streets. |
| No. 7 Magonigle: lithograph | 281 | The northern and southern grids, and the diagonal grid to the south-east, traced well. |
| No. 10 Griffiths, Coulter & Caswell: original | 298 | Most streets; strips between faint lot lines pass for lanes. |
| No. 18 Saarinen: lithograph | 318 | Radial and ring streets well traced; hatched grounds traced as rows of false streets. |
| No. 29 Griffin: lithograph, copy A | 307 | Much as copy B. |
| No. 29 Griffin: lithograph, copy B | 292 | Grids on flat ground good; broken on the steepest slopes. |
| No. 35 Schanfelberg, Rees & Gummer: lithograph | 266 | Dense grids traced well. |
| No. 37 Bérard: streets plan | 159 | Main avenues and the street network clean; spurs where the photograph's wash is pale. |
| No. 41 Comey: lithograph | 318 | Nearly the whole network traced. |
| No. 81 Gellerstedt: lithograph | 338 | Ring and radial streets traced; building outlines add short false streets. |

The totals include false streets, so do not compare designs by them until the drafts are corrected.

```sh
uv run python vectorise.py                       # every plan, about 1–2 minutes each
uv run python vectorise.py design-37-berard      # one plan
uv run python vectorise.py --tile 693700 6092500 694500 6093300 design-29-griffin-copyB   # one 800 m test tile
```

Debug overlays land in `work/debug/streets/`: the plan washed out, the designer's ink in dark grey, the survey's lines that were taken out in pale blue, kept centrelines in red and rejected skeleton edges in pale green.
A `--tile` run puts the original beside it.
The length traced for each plan is in `gcps/plans/streets.json`.
`make_web.sh` copies the centrelines into the preview, where each design has a checkbox and a click on a street gives its width.
A second page, `preview/streets.html`, draws them over a satellite image of Canberra today (Esri World Imagery), with the plan beneath on a slider and an option to draw each street at its traced width.
Run it alongside the first with `pnpm dev --port 5182` and open `/streets.html`; across the tailnet, `tailscale serve --bg --https=5183 http://127.0.0.1:5182`.

### What goes wrong

- **Streets that follow the contours.** Where a designer ran a street along a hillside within a few metres of a contour, the script takes the street's edge for the contour and loses it. Griffin's and Comey's terraced streets suffer most.
- **Faint lot lines.** Where a block's lot lines are too faint to count as ink, the strips between them pass for lanes (No. 10, in places).
- **Lanes within blocks.** Griffin drew many blocks as a pair of rectangles with a gap between; the gap is traced as a lane, which may well be what he meant.
- **Wide open ground.** Next to parks and open country, the space between a block and a nearby line can look like a street.
- **Lettering in the street.** Large lettering laid along a street can break the centreline into pieces.
- **Hatching.** Evenly spaced hatching (Saarinen's parks and public grounds) makes rows of strips of constant width, which pass for streets.
- **Railways.** A railway drawn as parallel lines is traced like a street.
- **The sheet's edge.** On some sheets the strip between the neatline and the edge of the scan is traced as a street.

## Things to know

- The sheets were printed separately and differ a little in paper tone, so the seams show as faint changes of colour.
  Lines carry across the seams to within a few metres.
- The heights on the map are in feet above sea level as the survey reckoned it; Ainslie is marked 2,762 ft (841.9 m), and the register gives 842.4 m AHD.
- The station coordinates come from the ACTmapi "ACTGOV Survey Control Mark" layer, downloaded on 13 November 2026.
- Source: National Library of Australia, [nla.obj-232175445](https://nla.gov.au/nla.obj-232175445). Out of copyright (published 1910).

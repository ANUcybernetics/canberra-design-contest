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
uv run python extract_sheets.py ../../nla.obj-232175445.zip
uv run python detect_grid.py
uv run python locate_stations.py
uv run python fit_and_warp.py
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

## Things to know

- The sheets were printed separately and differ a little in paper tone, so the seams show as faint changes of colour.
  Lines carry across the seams to within a few metres.
- The heights on the map are in feet above sea level as the survey reckoned it; Ainslie is marked 2,762 ft (841.9 m), and the register gives 842.4 m AHD.
- The station coordinates come from the ACTmapi "ACTGOV Survey Control Mark" layer, downloaded on 13 November 2026.
- Source: National Library of Australia, [nla.obj-232175445](https://nla.gov.au/nla.obj-232175445). Out of copyright (published 1910).

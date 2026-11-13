# Data

The GIS outputs of the georeferencing pipeline in [`georef/`](../georef/README.md), ready to open in QGIS.

None of it is committed, because it is large and can be made again: run the pipeline and this folder fills.
Only this README is kept in git.

Everything is in GDA2020 / MGA zone 55 (EPSG:7855) unless its name ends in `-3857`, which marks a Web Mercator copy made for the [preview](../demos/georef-preview/README.md).

| File | What it is | Made by |
| --- | --- | --- |
| `contour-survey-1910-mga55.tif` | The four sheets of the 1910 contour survey, stitched into one Cloud-Optimised GeoTIFF at 0.7 m per pixel. | `fit_and_warp.py` |
| `contour-survey-1910-grid.gpkg` | The 1910 grid lines, the sheet outlines and the control stations, for checking the fit. | `fit_and_warp.py` |
| `contour-survey-1910-3857.tif` | The composite in Web Mercator, for the preview. | `make_web.sh` |
| `plans/<plan>-mga55.tif` | Each 1912 competition plan, warped onto the survey. | `warp_plans.py`, `match_plans.py`, `gimson.py` |
| `plans/<plan>-3857.tif` | The same, in Web Mercator. | the same |
| `streets/<plan>.geojson` | The streets traced from each plan, as centrelines with widths. | `vectorise.py` |
| `streets/<plan>-repaired.geojson` | The same networks, mended. | `repair.py` |
| `streets-1912.gpkg` | Every traced and repaired network, a layer per design. | `vectorise.py`, `repair.py` |

The street networks are automatic first drafts; see the [georef README](../georef/README.md#tracing-the-streets) for what they get wrong.

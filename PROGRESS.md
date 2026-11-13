# Progress

## 2026-11-13

- Moved the georeferencing pipeline to the top of the repository (`georef/`), its GIS outputs to `data/` and the MapLibre preview to `demos/georef-preview/`.
  Every script now takes its paths from `georef/paths.py`.
  Tidied the Python with ruff (configured in `georef/pyproject.toml`), and brought the stale docstrings of `repair.py` and `mapstyle.py` up to date; a clean run from the scans reproduces every committed control point.
- Transcribed the 1912 judges' report, the 1911 conditions cover and the text of contour map Sheet 1 (`history/`).
- Georeferenced the 1910 contour survey: all four sheets stitched into one GeoTIFF in GDA2020 / MGA zone 55 (`georef/`).
  The survey grid's origin is the Ainslie trig; nine surviving 1910 trig stations tie it to MGA at 2.8 m RMS.
- Added a MapLibre preview of the composite over OpenStreetMap (`demos/georef-preview/`), reading a Web Mercator COG with hapmap.app's `cog://` protocol.
- Georeferenced 11 of the 13 competition plan images onto the same survey grid (`georef/plans.py`, `warp_plans.py`, `match_plans.py`), and added them to the preview.
  Ten were registered from their own 2,500 ft grid; Saarinen's lantern slide by matching it to his lithograph.
  Checked against the 1910 composite: no plan is offset overall; the lithographs wander locally by a median of 2–8 m, up to 32 m.
- Placed Gimson's No. 15 bird's-eye view approximately (`georef/gimson.py`): a perspective view, not a plan, so good only to a few hundred metres.
- Traced the streets of ten plans as centrelines with widths (`georef/vectorise.py`), into `data/streets-1912.gpkg` and the preview.
  The survey's contours are removed line by line (near and parallel), so street edges survive where contours cross them; Bérard's pale streets are found with a top-hat filter.
  These are automatic first drafts: good on flat ground (Comey's is nearly complete), weaker on steep ground, and fooled by hatching, faint lot lines and railways.
- Repaired the traced street networks (`georef/repair.py`): planted avenues collapsed from ladders of loops to single centrelines, wide roads to nowhere dropped unless drawn lines run along both sides, split crossroads merged, and streets refitted as straight lines and arcs checked against the plan's ink.
  Turning per kilometre, a measure of wiggle, fell by 50–70% on every plan.
- Gave the networks real connectivity (`repair.py`): cut streets joined where two dead ends face each other or one points at a street, wide roads that still go nowhere dropped, and every street classed whole by width, length and betweenness, with the main roads grown into a connected network.
- Added the railway, bridges and named public buildings to No. 10's styled map: the railway traced by eye, bridges where roads and rail cross water, and 44 of the 53 buildings in the plan's key named by reading their numbers (`georef/readings.py`).
- Drew No. 10 as a modern street map in the manner of Google Maps (`georef/mapstyle.py`, `demos/georef-preview/styled.html`): roads classed by traced width, water from the plan's blue shore wash, parks from the absence of lot lines, buildings from hatching, and the plan's own place names.

- Brought in Tom Griffiths's work: his Canberra Visions sim, a walkable PlayCanvas sketch with the bare 1911 site and Gimson's entry (`demos/cbrsim/`), and his transcription of L. A. Curtis's 1912 paper (`history/transcriptions/`).
  His large NLA scans are left out of git; each has a `SOURCE.md` with its download URL.

## Next

- Feed the sim from `georef/` and `data/`: steps 1 and 3 of `demos/cbrsim/PLAN.md` (the MGA55 frame and georeferencing the survey and plans) are already done there.

- Judge the harder joins (gaps over 60 m, joins across junctions) with a vision model against the plan (designed, not yet built; it costs API spend, so agree a budget first).
- Trace the railways and name the buildings of the other plans the way No. 10's were.
- Correct the street drafts by hand in QGIS, starting with the six shortlisted designs; mark edited features `source = "hand"`.
- Consider teaching the street tracer to recognise hatching (Saarinen) and railways, or train a small segmentation model on the corrected drafts.
- Next NLA visit: get and scan the items in `history/nla-visit-list.md`, starting with Bérard's streets plan and Gimson's plan.
- Find the inside pages of the 1911 conditions booklet.
- Consider evening out the paper tone between the four sheets in the composite.
- Georeference Saarinen's "central area" sheet and Agache's public-buildings photograph with hand-picked control points (no grid; automatic matching failed).
- Get Gimson's plan (NLA 445225, not digitised) via Copies Direct, or his report text, to replace or firm up the approximate No. 15 placement.
- Decide whether to rubber-sheet the lithographs onto the 1910 base map, removing the local wander of their redrawn contours (see `georef/README.md`).

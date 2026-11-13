#!/usr/bin/env bash
# Web copies of the GIS outputs for the MapLibre preview in
# demos/georef-preview/.  Run after fit_and_warp.py, warp_plans.py and
# vectorise.py / repair.py.
#
# - The composite as a Web Mercator (EPSG:3857) COG with 512 px blocks, the
#   way hapmap.app does it, read in the browser by the preview's src/cog.js.
#   WebP with an alpha band decodes natively in the browser (a JPEG COG would
#   carry a 1-bit mask, which cog.js misreads).
# - The 1910 grid, sheet outlines and control stations as WGS84 GeoJSON.
# - Links to each plan's Web Mercator COG, and a list of them for the page.
# - The street centrelines as WGS84 GeoJSON, and a list of them.
#
# The COGs stay in data/ and are linked into public/cog/, not copied.
set -euo pipefail
cd "$(dirname "$0")"
DATA=../data
PUBLIC=../demos/georef-preview/public
WEB="$PUBLIC/data"

# The 1910 composite.
COG="$DATA/contour-survey-1910-3857.tif"
rm -f "$COG"
gdalwarp -q -overwrite -t_srs EPSG:3857 -r cubic -dstalpha -multi -wo NUM_THREADS=ALL_CPUS \
  -of COG -co COMPRESS=WEBP -co QUALITY=90 -co BLOCKSIZE=512 -co OVERVIEWS=AUTO \
  -co OVERVIEW_RESAMPLING=AVERAGE -co NUM_THREADS=ALL_CPUS \
  work/warp/mosaic.vrt "$COG"
mkdir -p "$PUBLIC/cog"
ln -sfn ../../../../data/contour-survey-1910-3857.tif "$PUBLIC/cog/contour-survey-1910-3857.tif"
mkdir -p "$WEB"
for layer in grid sheets stations; do
  rm -f "$WEB/$layer.geojson"
  ogr2ogr -f GeoJSON -t_srs EPSG:4326 -lco COORDINATE_PRECISION=7 "$WEB/$layer.geojson" \
    "$DATA/contour-survey-1910-grid.gpkg" "$layer"
done
ls -la "$COG" "$WEB"

# The 1912 competition plans (from warp_plans.py, match_plans.py, gimson.py).
mkdir -p "$PUBLIC/cog/plans"
find "$PUBLIC/cog/plans" -type l -delete
for f in "$DATA"/plans/*-3857.tif; do
  [ -e "$f" ] || continue
  ln -sfn "../../../../../data/plans/$(basename "$f")" "$PUBLIC/cog/plans/$(basename "$f")"
done
uv run python - <<'PY'
import json
from paths import PLAN_COGS, WEB_DATA
from plans import PLANS
out = []
for name, spec in PLANS.items():
    if (PLAN_COGS / f"{name}-3857.tif").exists():
        out.append({"id": name, "label": spec["label"], "cog": f"/cog/plans/{name}-3857.tif"})
# Gimson's bird's-eye view: a perspective, placed only approximately (gimson.py).
g = "design-15-gimson-birdseye-approx"
if (PLAN_COGS / f"{g}-3857.tif").exists():
    out.append({"id": g, "label": "No. 15 Gimson: bird's-eye view, APPROXIMATE (±200–300 m)", "cog": f"/cog/plans/{g}-3857.tif"})
(WEB_DATA / "plans.json").write_text(json.dumps(out, indent=1))
print(f"{len(out)} plans listed for the preview")
PY

# Street centrelines (vectorise.py): the repaired network (repair.py) if
# there is one, else the trace.
mkdir -p "$WEB/streets"
rm -f "$WEB/streets/"*.geojson
for f in "$DATA"/streets/design-*.geojson; do
  [ -e "$f" ] || continue
  case "$f" in *-tile.geojson|*-repaired.geojson) continue ;; esac
  src="${f%.geojson}-repaired.geojson"
  [ -e "$src" ] || src="$f"
  ogr2ogr -f GeoJSON -s_srs EPSG:7855 -t_srs EPSG:4326 -lco COORDINATE_PRECISION=7 \
    "$WEB/streets/$(basename "$f")" "$src"
done
uv run python - <<'PY'
import json
from paths import WEB_DATA
from plans import PLANS
out = []
for name, spec in PLANS.items():
    f = WEB_DATA / "streets" / f"{name}.geojson"
    if f.exists():
        feats = json.loads(f.read_text())["features"]
        km = round(sum(x["properties"]["length_m"] for x in feats) / 1000)
        out.append({"id": name, "label": spec["label"], "geojson": f"/data/streets/{name}.geojson", "km": km})
(WEB_DATA / "streets.json").write_text(json.dumps(out, indent=1))
print(f"{len(out)} street layers listed for the preview")
PY

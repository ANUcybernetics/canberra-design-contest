#!/usr/bin/env bash
# Web copy of the composite for the MapLibre preview, the way hapmap.app does
# it: a Web Mercator (EPSG:3857) COG with 512 px blocks, read in the browser
# by preview/src/cog.js.  WebP with an alpha band decodes natively in the
# browser (a JPEG COG would carry a 1-bit mask, which cog.js misreads).
# Also exports the 1910
# grid, sheet outlines and control stations as WGS84 GeoJSON.
# Run after fit_and_warp.py.
set -euo pipefail
cd "$(dirname "$0")"
OUT=output/contour-survey-1910-3857.tif
DATA=preview/public/data
rm -f "$OUT"
gdalwarp -q -overwrite -t_srs EPSG:3857 -r cubic -dstalpha -multi -wo NUM_THREADS=ALL_CPUS \
  -of COG -co COMPRESS=WEBP -co QUALITY=90 -co BLOCKSIZE=512 -co OVERVIEWS=AUTO \
  -co OVERVIEW_RESAMPLING=AVERAGE -co NUM_THREADS=ALL_CPUS \
  work/warp/mosaic.vrt "$OUT"
# The preview serves the COG from public/cog/.
mkdir -p preview/public/cog
ln -sfn ../../../output/contour-survey-1910-3857.tif preview/public/cog/contour-survey-1910-3857.tif
mkdir -p "$DATA"
for layer in grid sheets stations; do
  rm -f "$DATA/$layer.geojson"
  ogr2ogr -f GeoJSON -t_srs EPSG:4326 -lco COORDINATE_PRECISION=7 "$DATA/$layer.geojson" \
    output/contour-survey-1910-grid.gpkg "$layer"
done
ls -la "$OUT" "$DATA"

# 1912 competition plans (from warp_plans.py / match_plans.py): link their
# Web Mercator COGs into the preview and list them for the page.
mkdir -p preview/public/cog/plans
find preview/public/cog/plans -type l -delete
for f in output/plans/*-3857.tif; do
  [ -e "$f" ] || continue
  ln -sfn "../../../../$f" "preview/public/cog/plans/$(basename "$f")"
done
uv run python - <<'PY'
import json
from pathlib import Path
from plans import PLANS
out = []
for name, spec in PLANS.items():
    if Path(f"output/plans/{name}-3857.tif").exists():
        out.append({"id": name, "label": spec["label"], "cog": f"/cog/plans/{name}-3857.tif"})
# Gimson's bird's-eye view: a perspective, placed only approximately (gimson.py).
g = "design-15-gimson-birdseye-approx"
if Path(f"output/plans/{g}-3857.tif").exists():
    out.append({"id": g, "label": "No. 15 Gimson: bird's-eye view, APPROXIMATE (±200–300 m)", "cog": f"/cog/plans/{g}-3857.tif"})
Path("preview/public/data/plans.json").write_text(json.dumps(out, indent=1))
print(f"{len(out)} plans listed for the preview")
PY

# Street centrelines traced by vectorise.py: WGS84 copies for the preview.
mkdir -p "$DATA/streets"
rm -f "$DATA/streets/"*.geojson
for f in output/streets/design-*.geojson; do
  [ -e "$f" ] || continue
  case "$f" in *-tile.geojson|*-repaired.geojson) continue ;; esac
  # The repaired network (repair.py) if there is one, else the trace.
  src="${f%.geojson}-repaired.geojson"
  [ -e "$src" ] || src="$f"
  ogr2ogr -f GeoJSON -s_srs EPSG:7855 -t_srs EPSG:4326 -lco COORDINATE_PRECISION=7 \
    "$DATA/streets/$(basename "$f")" "$src"
done
uv run python - <<'PY'
import json
from pathlib import Path
from plans import PLANS
out = []
for name, spec in PLANS.items():
    f = Path(f"preview/public/data/streets/{name}.geojson")
    if f.exists():
        feats = json.loads(f.read_text())["features"]
        km = round(sum(x["properties"]["length_m"] for x in feats) / 1000)
        out.append({"id": name, "label": spec["label"], "geojson": f"/data/streets/{name}.geojson", "km": km})
Path("preview/public/data/streets.json").write_text(json.dumps(out, indent=1))
print(f"{len(out)} street layers listed for the preview")
PY

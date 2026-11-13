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

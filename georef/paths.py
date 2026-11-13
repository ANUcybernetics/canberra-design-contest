"""Where the pipeline reads and writes, relative to the repository root.

    history/scans/          the NLA downloads (not committed)
    georef/                 this code
    georef/gcps/            the control points and summaries it finds (committed)
    georef/work/            scratch: unpacked sheets, intermediate rasters,
                            debug overlays (not committed)
    data/                   the GIS outputs, for QGIS (not committed)
    demos/georef-preview/   the MapLibre preview; make_web.sh and mapstyle.py
                            write its web copies into public/
"""

from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# Inputs
SCANS = ROOT / "history" / "scans"

# Control points and run summaries, small enough to commit
GCP_DIR = HERE / "gcps"
PLAN_GCP_DIR = GCP_DIR / "plans"

# Scratch
WORK = HERE / "work"

# GIS outputs
DATA = ROOT / "data"
COMPOSITE = DATA / "contour-survey-1910-mga55.tif"
GRID_GPKG = DATA / "contour-survey-1910-grid.gpkg"
PLAN_COGS = DATA / "plans"
STREETS = DATA / "streets"
STREETS_GPKG = DATA / "streets-1912.gpkg"

# The preview's web copies
DEMO = ROOT / "demos" / "georef-preview"
WEB_DATA = DEMO / "public" / "data"

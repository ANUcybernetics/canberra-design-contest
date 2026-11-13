"""Warp the 1912 competition plans onto GDA2020 / MGA zone 55.

Each plan's grid crossings (gcps/plans/<plan>_grid.csv, from plans.py) have
known survey-grid coordinates; the survey grid -> MGA55 similarity transform
fitted for the 1910 contour survey (gcps/transform.json) carries them to the
ground.  The plan is then warped with a thin-plate spline through its 81
crossings and clipped to the survey's outer frame.

Check: the plans were drawn on the 1910 survey, so their contours and river
should sit exactly on the georeferenced 1910 composite.  We phase-correlate
the warped plan's linework against the composite's and report the shift; a
mislabelled grid would show up as a shift of ~762 m (one 2,500 ft interval).

Outputs (gitignored)
  data/plans/<plan>-mga55.tif   COG, EPSG:7855, for QGIS
  data/plans/<plan>-3857.tif    Web Mercator COG (WebP + alpha) for the preview

Usage: uv run python warp_plans.py [plan ...]
"""

import csv
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from fit_and_warp import box_ring, helmert, write_cutline
from paths import COMPOSITE, GCP_DIR, PLAN_COGS, PLAN_GCP_DIR, WORK
from plans import PLANS, SRC

EPSG = 7855
TMP = WORK / "plans"


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)


def load_transform():
    t = json.loads(Path(GCP_DIR / "transform.json").read_text())
    return {k: t[k] for k in ("a", "b", "E0", "N0")}, t["outer_margins_ft"]


def full_extent(m):
    return (-m["east"], 20000 + m["west"], -m["north"], 20000 + m["south"])


def warp(name, h, m, gcp_csv=None, method="-tps", res=None):
    rows = list(csv.DictReader(Path(gcp_csv or PLAN_GCP_DIR / f"{name}_grid.csv").read_text().splitlines()))
    gcps = []
    for r in rows:
        if "e" in r:  # already in MGA (feature-matched plans)
            E, N = float(r["e"]), float(r["n"])
        else:
            E, N = helmert(h, float(r["ft_west"]), float(r["ft_south"]))
        gcps += ["-gcp", r["px"], r["py"], f"{E:.3f}", f"{N:.3f}"]
    if res is None:
        # native resolution from the spacing of the crossings (2,500 ft apart)
        px = np.array([[float(r["px"]), float(r["py"])] for r in rows]).reshape(9, 9, 2)
        step = np.median(np.hypot(*np.diff(px, axis=1).reshape(-1, 2).T))
        res = round(2500 * 0.3048 / step, 2)
    TMP.mkdir(parents=True, exist_ok=True)
    PLAN_COGS.mkdir(parents=True, exist_ok=True)
    vrt = TMP / f"{name}_gcps.vrt"
    run(["gdal_translate", "-q", "-of", "VRT", "-a_srs", f"EPSG:{EPSG}", *gcps, str(SRC / PLANS[name]["file"]), str(vrt)])
    cut = TMP / f"{name}_cut.geojson"
    write_cutline(cut, box_ring(h, full_extent(m)))
    warped = TMP / f"{name}_mga55_warp.tif"
    warped.unlink(missing_ok=True)
    run(
        [
            "gdalwarp",
            "-q",
            *method.split(),
            "-r",
            "cubic",
            "-t_srs",
            f"EPSG:{EPSG}",
            "-tr",
            str(res),
            str(res),
            "-tap",
            "-cutline",
            str(cut),
            "-crop_to_cutline",
            "-dstalpha",
            "-multi",
            "-wo",
            "NUM_THREADS=ALL_CPUS",
            "-co",
            "TILED=YES",
            "-co",
            "COMPRESS=DEFLATE",
            "-co",
            "PREDICTOR=2",
            "-co",
            "BIGTIFF=IF_SAFER",
            str(vrt),
            str(warped),
        ]
    )
    # The lantern slide is greyscale: expand to RGB so every output looks alike.
    bands = int(subprocess.run(["gdalinfo", "-json", str(warped)], capture_output=True, text=True, check=True).stdout.count('"band":'))
    expand = ["-b", "1", "-b", "1", "-b", "1", "-b", "2"] if bands == 2 else []
    mga = PLAN_COGS / f"{name}-mga55.tif"
    mga.unlink(missing_ok=True)
    run(
        [
            "gdal_translate",
            "-q",
            *expand,
            "-of",
            "COG",
            "-co",
            "COMPRESS=JPEG",
            "-co",
            "QUALITY=90",
            "-co",
            "NUM_THREADS=ALL_CPUS",
            "-co",
            "OVERVIEW_RESAMPLING=AVERAGE",
            str(warped),
            str(mga),
        ]
    )
    web = PLAN_COGS / f"{name}-3857.tif"
    web.unlink(missing_ok=True)
    srcband = [] if not expand else ["-b", "1", "-b", "1", "-b", "1", "-b", "2"]
    tmp_rgba = TMP / f"{name}_rgba.vrt"
    run(["gdal_translate", "-q", "-of", "VRT", *srcband, str(warped), str(tmp_rgba)])
    run(
        [
            "gdalwarp",
            "-q",
            "-overwrite",
            "-t_srs",
            "EPSG:3857",
            "-r",
            "cubic",
            "-multi",
            "-wo",
            "NUM_THREADS=ALL_CPUS",
            "-of",
            "COG",
            "-co",
            "COMPRESS=WEBP",
            "-co",
            "QUALITY=85",
            "-co",
            "BLOCKSIZE=512",
            "-co",
            "OVERVIEWS=AUTO",
            "-co",
            "OVERVIEW_RESAMPLING=AVERAGE",
            "-co",
            "NUM_THREADS=ALL_CPUS",
            str(tmp_rgba),
            str(web),
        ]
    )
    return warped, res


def edges(path, bounds, res=4.0):
    """Linework strength of a raster, resampled onto a common grid."""
    out = TMP / f"{path.stem}_qa_{res:g}m.tif"
    xmin, ymin, xmax, ymax = bounds
    run(
        [
            "gdalwarp",
            "-q",
            "-overwrite",
            "-te",
            str(xmin),
            str(ymin),
            str(xmax),
            str(ymax),
            "-tr",
            str(res),
            str(res),
            "-r",
            "average",
            "-dstnodata",
            "0",
            "-ot",
            "Byte",
            "-b",
            "1",
            str(path),
            str(out),
        ]
    )
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = None
    a = np.array(Image.open(out), dtype=np.float32)
    if a.ndim == 3:  # gdalwarp may carry the alpha band along
        a = a[..., 0]
    valid = a > 0
    a[~valid] = np.median(a[valid]) if valid.any() else 0
    # dark thin lines -> high values; remove the broad tone
    k = 9
    pad = np.pad(a, k, mode="edge")
    c = np.cumsum(np.cumsum(pad, 0), 1)
    box = (c[2 * k :, 2 * k :] - c[: -2 * k, 2 * k :] - c[2 * k :, : -2 * k] + c[: -2 * k, : -2 * k]) / (2 * k) ** 2
    e = np.clip(box[: a.shape[0], : a.shape[1]] - a, 0, None)
    e[~valid] = 0
    return e


def check_against_composite(warped, name):
    info = json.loads(subprocess.run(["gdalinfo", "-json", str(warped)], capture_output=True, text=True, check=True).stdout)
    (xmin, ymax), (xmax, ymin) = info["cornerCoordinates"]["upperLeft"], info["cornerCoordinates"]["lowerRight"]
    res = 4.0
    a = edges(warped, (xmin, ymin, xmax, ymax), res)
    b = edges(COMPOSITE, (xmin, ymin, xmax, ymax), res)
    n = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    a, b = a[: n[0], : n[1]], b[: n[0], : n[1]]
    a = (a - a.mean()) * np.hanning(n[0])[:, None] * np.hanning(n[1])[None, :]
    b = (b - b.mean()) * np.hanning(n[0])[:, None] * np.hanning(n[1])[None, :]
    F = np.fft.fft2(a) * np.conj(np.fft.fft2(b))
    r = np.fft.ifft2(F / (np.abs(F) + 1e-9)).real
    j, i = np.unravel_index(r.argmax(), r.shape)
    dy = j if j < n[0] / 2 else j - n[0]
    dx = i if i < n[1] / 2 else i - n[1]
    peak = r.max() / r.std()
    return dx * res, -dy * res, peak


def main(names):
    h, m = load_transform()
    summary = {}
    for name in names:
        if not (PLAN_GCP_DIR / f"{name}_grid.csv").exists():
            print(f"{name}: no grid crossings; skipped")
            continue
        warped, res = warp(name, h, m)
        dx, dy, peak = check_against_composite(warped, name)
        print(f"{name}: {res} m/px; shift vs 1910 composite dE {dx:+.0f} m dN {dy:+.0f} m (peak {peak:.0f} sigma)")
        summary[name] = {"res_m": res, "shift_e_m": dx, "shift_n_m": dy, "peak_sigma": round(float(peak), 1)}
    if summary:
        path = PLAN_GCP_DIR / "warp_check.json"
        old = json.loads(Path(path).read_text()) if path.exists() else {}
        old.update(summary)
        path.write_text(json.dumps(old, indent=2))


if __name__ == "__main__":
    main(sys.argv[1:] or list(PLANS))

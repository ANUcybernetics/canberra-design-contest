"""Tie the 1910 survey grid to GDA2020 / MGA zone 55 and build the composite.

Steps
1. Per sheet, fit a 2nd-order polynomial from scan pixels to survey-grid feet
   using the 25 detected grid intersections (gcps/sheetN_grid.csv).  Its
   residuals measure how evenly the paper has shrunk.
2. Convert each located trig station (gcps/stations.csv) to survey-grid feet.
3. Fit a 2-D similarity transform (shift, rotation, scale) from survey-grid
   feet to MGA55 metres using the stations that survive in the ACT register.
   Ainslie is the grid origin, so this mostly recovers the rotation between
   the 1910 trigonometrical meridian and MGA grid north.
4. Warp each sheet with a thin-plate spline through its 25 grid
   intersections (now in MGA55), clip it to its own quarter of the grid, and
   mosaic the four into one Cloud-Optimised GeoTIFF.

Outputs
  data/contour-survey-1910-mga55.tif   the composite (EPSG:7855)
  data/contour-survey-1910-grid.gpkg   1910 grid lines, sheet outlines and
                                         control stations, for checking in QGIS
  gcps/transform.json                    fitted parameters and residuals

Usage: uv run python fit_and_warp.py
"""

import csv
import json
import math
import shutil
import subprocess

import numpy as np

from paths import COMPOSITE, DATA, GCP_DIR, GRID_GPKG, ROOT, WORK
from sheets import GRID_STEP_FT, SHEET_DIR, SHEETS

FT = 0.3048  # metres per foot; the similarity fit's scale absorbs any difference
RES_M = 0.7  # output pixel size; the scans are ~0.74 m/px at map scale
EPSG = 7855  # GDA2020 / MGA zone 55
# Red Hill is plotted for checking only: the register's RED HILL ECCE is an
# eccentric station and may not mark the 1910 point.
CHECK_ONLY = {"Red Hill"}


def run(cmd: list[str]) -> None:
    print("  $", " ".join(cmd[:3]), "...")
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)


def poly2(x, y):
    return np.column_stack([np.ones_like(x), x, y, x * x, x * y, y * y])


def read_csv(path):
    with open(path) as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------- step 1, 2
def fit_sheets():
    fits = {}
    for n in SHEETS:
        rows = read_csv(GCP_DIR / f"sheet{n}_grid.csv")
        px = np.array([float(r["px"]) for r in rows])
        py = np.array([float(r["py"]) for r in rows])
        W = np.array([float(r["ft_west"]) for r in rows])
        S = np.array([float(r["ft_south"]) for r in rows])
        A = poly2(px, py)
        cw, *_ = np.linalg.lstsq(A, W, rcond=None)
        cs, *_ = np.linalg.lstsq(A, S, rcond=None)
        res = np.hypot(A @ cw - W, A @ cs - S)
        # mean feet per pixel, from the linear terms
        ftpx = math.sqrt(abs(cw[1] * cs[2] - cw[2] * cs[1]))
        fits[n] = {"cw": cw, "cs": cs, "px": px, "py": py, "W": W, "S": S, "ftpx": ftpx, "rms_ft": float(np.sqrt((res**2).mean()))}
        print(f"  sheet {n}: {ftpx:.3f} ft/px, grid poly2 rms {fits[n]['rms_ft']:.2f} ft (max {res.max():.2f})")
    return fits


def px_to_grid(fit, x, y):
    A = poly2(np.atleast_1d(x), np.atleast_1d(y))
    return float((A @ fit["cw"])[0]), float((A @ fit["cs"])[0])


# ---------------------------------------------------------------- step 3
def grid_to_local_m(W, S):
    """Survey grid (ft W, ft S of Ainslie) -> local metres (east, north)."""
    return -np.asarray(W) * FT, -np.asarray(S) * FT


def fit_helmert(stations):
    use = [s for s in stations if s["station"] not in CHECK_ONLY]
    xe, yn = grid_to_local_m([s["W"] for s in use], [s["S"] for s in use])
    E = np.array([s["e"] for s in use])
    N = np.array([s["n"] for s in use])
    A = np.zeros((2 * len(use), 4))
    A[0::2] = np.column_stack([xe, -yn, np.ones_like(xe), np.zeros_like(xe)])
    A[1::2] = np.column_stack([yn, xe, np.zeros_like(xe), np.ones_like(xe)])
    obs = np.empty(2 * len(use))
    obs[0::2], obs[1::2] = E, N
    p, *_ = np.linalg.lstsq(A, obs, rcond=None)
    return {"a": p[0], "b": p[1], "E0": p[2], "N0": p[3]}


def helmert(h, W, S):
    xe, yn = grid_to_local_m(W, S)
    return h["E0"] + h["a"] * xe - h["b"] * yn, h["N0"] + h["b"] * xe + h["a"] * yn


# ---------------------------------------------------------------- neatlines
def detect_margins(fits):
    """Distance (ft) from the outermost grid lines out to each sheet's neatline."""
    from PIL import Image

    from detect_grid import ink_mask

    Image.MAX_IMAGE_PIXELS = None
    outer = {1: ("west", "north"), 2: ("east", "north"), 3: ("west", "south"), 4: ("east", "south")}
    found = {k: [] for k in ("west", "east", "north", "south")}
    for n, edges in outer.items():
        mask = ink_mask(np.asarray(Image.open(SHEET_DIR / SHEETS[n]["file"]).convert("RGB")))
        f = fits[n]
        for edge in edges:
            if edge in ("west", "east"):
                prof = mask.sum(0).astype(float)
                line = f["px"][f["W"] == (20000 if edge == "west" else 0)].mean()
                sign = -1 if edge == "west" else 1
            else:
                prof = mask.sum(1).astype(float)
                line = f["py"][f["S"] == (0 if edge == "north" else 20000)].mean()
                sign = -1 if edge == "north" else 1
            # First long line beyond the grid line is the inner neatline.
            limit = 0.5 * (mask.shape[0] if edge in ("west", "east") else mask.shape[1])
            for d in range(40, 400):
                i = round(line + sign * d)
                if 0 <= i < len(prof) and prof[i] > limit:
                    found[edge].append(d * f["ftpx"])
                    break
    margins = {k: min(v) for k, v in found.items() if v}
    for k, v in found.items():
        print(f"  {k:5s} neatline: " + ", ".join(f"{x:.0f}" for x in v) + " ft beyond outer grid line")
    # Stop just inside the neatline so the frame itself is not drawn.
    return {k: math.floor(v - 15) for k, v in margins.items()}


def sheet_extent(n, m):
    """Grid-feet box (W_min, W_max, S_min, S_max) that sheet n contributes."""
    west = n in (1, 3)
    north = n in (1, 2)
    W = (10000, 20000 + m["west"]) if west else (-m["east"], 10000)
    S = (-m["north"], 10000) if north else (10000, 20000 + m["south"])
    return W + S


# ---------------------------------------------------------------- outputs
def write_cutline(path, ring):
    gj = {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{EPSG}"}},
        "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [ring]}}],
    }
    path.write_text(json.dumps(gj))


def box_ring(h, box, step=500):
    Wmin, Wmax, Smin, Smax = box
    pts = []
    for W in np.arange(Wmin, Wmax, step):
        pts.append((W, Smin))
    for S in np.arange(Smin, Smax, step):
        pts.append((Wmax, S))
    for W in np.arange(Wmax, Wmin, -step):
        pts.append((W, Smax))
    for S in np.arange(Smax, Smin, -step):
        pts.append((Wmin, S))
    pts.append(pts[0])
    return [list(map(float, helmert(h, W, S))) for W, S in pts]


def write_check_layers(h, stations, m):
    feats = {"grid": [], "sheets": [], "stations": []}
    for W in range(0, 20001, GRID_STEP_FT):
        line = [list(map(float, helmert(h, W, S))) for S in (-m["north"], 20000 + m["south"])]
        feats["grid"].append(
            {"type": "Feature", "properties": {"kind": "meridian", "ft_west": W}, "geometry": {"type": "LineString", "coordinates": line}}
        )
    for S in range(0, 20001, GRID_STEP_FT):
        line = [list(map(float, helmert(h, W, S))) for W in (-m["east"], 20000 + m["west"])]
        feats["grid"].append(
            {"type": "Feature", "properties": {"kind": "parallel", "ft_south": S}, "geometry": {"type": "LineString", "coordinates": line}}
        )
    for n in SHEETS:
        feats["sheets"].append(
            {
                "type": "Feature",
                "properties": {"sheet": n},
                "geometry": {"type": "Polygon", "coordinates": [box_ring(h, sheet_extent(n, m))]},
            }
        )
    for s in stations:
        feats["stations"].append(
            {
                "type": "Feature",
                "properties": {k: s[k] for k in ("station", "sheet", "register_mark", "register_condition", "W", "S", "resid_m", "used")},
                "geometry": {"type": "Point", "coordinates": [s["e"], s["n"]]},
            }
        )
    gpkg = GRID_GPKG
    gpkg.unlink(missing_ok=True)
    for layer, fs in feats.items():
        tmp = WORK / f"{layer}.geojson"
        tmp.write_text(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{EPSG}"}},
                    "features": fs,
                }
            )
        )
        run(["ogr2ogr", "-f", "GPKG", "-append", "-nln", layer, "-a_srs", f"EPSG:{EPSG}", str(gpkg), str(tmp)])


def main():
    DATA.mkdir(exist_ok=True)
    (WORK / "warp").mkdir(parents=True, exist_ok=True)

    print("Step 1: scan pixels -> survey grid")
    fits = fit_sheets()

    print("Step 2: stations -> survey grid")
    stations = []
    for r in read_csv(GCP_DIR / "stations.csv"):
        W, S = px_to_grid(fits[int(r["sheet"])], float(r["px"]), float(r["py"]))
        stations.append(
            {
                "station": r["station"],
                "sheet": int(r["sheet"]),
                "W": W,
                "S": S,
                "e": float(r["mga55_e"]),
                "n": float(r["mga55_n"]),
                "register_mark": r["register_mark"],
                "register_condition": r["register_condition"],
            }
        )
        print(f"  {r['station']:15s} {W:9.1f} ft W {S:9.1f} ft S")

    print("Step 3: survey grid -> MGA55 (similarity)")
    h = fit_helmert(stations)
    scale = math.hypot(h["a"], h["b"])
    rot = math.degrees(math.atan2(h["b"], h["a"]))
    print(f"  origin (Ainslie) at E {h['E0']:.2f} N {h['N0']:.2f}")
    print(f"  rotation {rot:+.4f} deg (grid north of the 1910 meridian, anticlockwise +), scale {scale:.6f} x international foot")
    for s in stations:
        E, N = helmert(h, s["W"], s["S"])
        s["dE"], s["dN"] = float(E - s["e"]), float(N - s["n"])
        s["resid_m"] = round(math.hypot(s["dE"], s["dN"]), 2)
        s["used"] = s["station"] not in CHECK_ONLY
        print(
            f"  {s['station']:15s} residual {s['resid_m']:6.2f} m  (dE {s['dE']:+6.2f}, dN {s['dN']:+6.2f}){'' if s['used'] else '  [check only]'}"
        )
    used = [s["resid_m"] for s in stations if s["used"]]
    rms = float(np.sqrt(np.mean(np.square(used))))
    print(f"  control rms {rms:.2f} m over {len(used)} stations")

    print("Neatlines")
    m = detect_margins(fits)
    print(f"  outer margins used (ft): {m}")

    with open(GCP_DIR / "transform.json", "w") as fh:
        json.dump(
            {
                "description": "1910 Federal Capital contour survey grid (ft W / ft S of Trig. Stn AINSLIE) -> GDA2020 / MGA zone 55",
                "model": "E = E0 + a*x - b*y ; N = N0 + b*x + a*y ; x = -ft_west*0.3048, y = -ft_south*0.3048",
                "a": h["a"],
                "b": h["b"],
                "E0": h["E0"],
                "N0": h["N0"],
                "rotation_deg": rot,
                "scale": scale,
                "control_rms_m": rms,
                "stations": [
                    {
                        k: s[k]
                        for k in (
                            "station",
                            "sheet",
                            "W",
                            "S",
                            "e",
                            "n",
                            "dE",
                            "dN",
                            "resid_m",
                            "used",
                            "register_mark",
                            "register_condition",
                        )
                    }
                    for s in stations
                ],
                "sheet_grid_rms_ft": {n: f["rms_ft"] for n, f in fits.items()},
                "outer_margins_ft": m,
            },
            fh,
            indent=2,
        )

    print("Step 4: warp sheets")
    warped = []
    for n, spec in SHEETS.items():
        f = fits[n]
        gcp_args = []
        for x, y, W, S in zip(f["px"], f["py"], f["W"], f["S"]):
            E, N = helmert(h, W, S)
            gcp_args += ["-gcp", f"{x:.2f}", f"{y:.2f}", f"{E:.3f}", f"{N:.3f}"]
        vrt = WORK / "warp" / f"sheet{n}_gcps.vrt"
        run(["gdal_translate", "-q", "-of", "VRT", "-a_srs", f"EPSG:{EPSG}", *gcp_args, str(SHEET_DIR / spec["file"]), str(vrt)])
        cut = WORK / "warp" / f"sheet{n}_cut.geojson"
        write_cutline(cut, box_ring(h, sheet_extent(n, m)))
        tif = WORK / "warp" / f"sheet{n}_mga55.tif"
        tif.unlink(missing_ok=True)
        run(
            [
                "gdalwarp",
                "-q",
                "-tps",
                "-r",
                "cubic",
                "-t_srs",
                f"EPSG:{EPSG}",
                "-tr",
                str(RES_M),
                str(RES_M),
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
                str(vrt),
                str(tif),
            ]
        )
        warped.append(str(tif))

    print("Mosaic -> COG")
    mosaic = WORK / "warp" / "mosaic.vrt"
    run(["gdalbuildvrt", "-q", str(mosaic), *warped])
    final = COMPOSITE
    final.unlink(missing_ok=True)
    run(
        [
            "gdal_translate",
            "-q",
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
            str(mosaic),
            str(final),
        ]
    )

    print("Check layers -> GeoPackage")
    write_check_layers(h, stations, m)
    print(f"  done: {final.relative_to(ROOT)}")
    if shutil.which("gdalinfo"):
        subprocess.run(["gdalinfo", "-nomd", str(final)], check=False)


if __name__ == "__main__":
    main()

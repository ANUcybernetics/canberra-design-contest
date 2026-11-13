"""Local check of each warped plan against the 1910 composite.

Splits the overlap into ~1.2 km blocks and phase-correlates the plan's
linework with the composite's in each, at 2 m resolution.  Blocks whose
correlation peak is weak (mostly design ink, or blank) are skipped.

Usage: uv run python qa_local.py [plan ...]
"""

import json
import subprocess
import sys

import numpy as np

from plans import PLANS
from paths import COMPOSITE, PLAN_COGS, PLAN_GCP_DIR
from warp_plans import TMP, edges

RES = 2.0
BLOCK = 600  # pixels at RES -> 1.2 km


def shift(a, b):
    n = a.shape
    w = np.hanning(n[0])[:, None] * np.hanning(n[1])[None, :]
    A, B = np.fft.fft2((a - a.mean()) * w), np.fft.fft2((b - b.mean()) * w)
    F = A * np.conj(B)
    r = np.fft.ifft2(F / (np.abs(F) + 1e-9)).real
    j, i = np.unravel_index(r.argmax(), r.shape)
    dy = j if j < n[0] / 2 else j - n[0]
    dx = i if i < n[1] / 2 else i - n[1]
    return dx * RES, -dy * RES, r.max() / r.std()


def check(name):
    tif = PLAN_COGS / f"{name}-mga55.tif"
    info = json.loads(subprocess.run(["gdalinfo", "-json", str(tif)], capture_output=True, text=True, check=True).stdout)
    (xmin, ymax), (xmax, ymin) = info["cornerCoordinates"]["upperLeft"], info["cornerCoordinates"]["lowerRight"]
    a = edges(tif, (xmin, ymin, xmax, ymax), RES)
    (TMP / "composite_qa_src.vrt").unlink(missing_ok=True)
    b = edges(COMPOSITE, (xmin, ymin, xmax, ymax), RES)
    n = min(a.shape[0], b.shape[0]), min(a.shape[1], b.shape[1])
    out = []
    for y in range(0, n[0] - BLOCK + 1, BLOCK):
        for x in range(0, n[1] - BLOCK + 1, BLOCK):
            pa, pb = a[y : y + BLOCK, x : x + BLOCK], b[y : y + BLOCK, x : x + BLOCK]
            if pa.std() == 0 or pb.std() == 0:
                continue
            dx, dy, peak = shift(pa, pb)
            if peak > 12:
                out.append((dx, dy, peak))
    d = np.array([np.hypot(dx, dy) for dx, dy, _ in out])
    print(f"{name}: {len(out)} blocks; offset median {np.median(d):.1f} m, 90th pct {np.percentile(d, 90):.1f} m, max {d.max():.1f} m")
    return {"blocks": len(out), "median_m": float(np.median(d)), "p90_m": float(np.percentile(d, 90)), "max_m": float(d.max())}


if __name__ == "__main__":
    names = sys.argv[1:] or [p for p in PLANS if (PLAN_COGS / f"{p}-mga55.tif").exists()]
    res = {n: check(n) for n in names}
    path = PLAN_GCP_DIR / "qa_local.json"
    old = json.loads(path.read_text()) if path.exists() else {}
    old.update(res)
    path.write_text(json.dumps(old, indent=2) + "\n")

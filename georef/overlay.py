"""Quick visual check: a warped plan (grey) over the 1910 composite's linework (red).

Usage: uv run python overlay.py <plan> [res_m] [xmin ymin xmax ymax]
"""

import json
import subprocess
import sys

import numpy as np
from PIL import Image

from paths import COMPOSITE, PLAN_COGS
from plans import DEBUG
from warp_plans import TMP

Image.MAX_IMAGE_PIXELS = None


def grab(src, bounds, res, out):
    subprocess.run(
        [
            "gdalwarp",
            "-q",
            "-overwrite",
            "-te",
            *map(str, bounds),
            "-tr",
            str(res),
            str(res),
            "-r",
            "average",
            "-ot",
            "Byte",
            "-b",
            "1",
            str(src),
            str(out),
        ],
        check=True,
    )
    a = np.array(Image.open(out), dtype=np.float32)
    return a[..., 0] if a.ndim == 3 else a


def main():
    name = sys.argv[1]
    res = float(sys.argv[2]) if len(sys.argv) > 2 else 4.0
    tif = PLAN_COGS / f"{name}-mga55.tif"
    if len(sys.argv) > 6:
        bounds = [float(v) for v in sys.argv[3:7]]
    else:
        info = json.loads(subprocess.run(["gdalinfo", "-json", str(COMPOSITE)], capture_output=True, text=True, check=True).stdout)
        (x0, y1), (x1, y0) = info["cornerCoordinates"]["upperLeft"], info["cornerCoordinates"]["lowerRight"]
        bounds = [x0, y0, x1, y1]
    p = grab(tif, bounds, res, TMP / "ov_plan.tif")
    c = grab(COMPOSITE, bounds, res, TMP / "ov_comp.tif")
    rgb = np.stack([p, p, p], -1)
    # composite ink (dark in band 1 of the red-contoured map) -> red overlay
    ink = np.clip((np.median(c) - c) / 60, 0, 1)
    rgb[..., 0] = rgb[..., 0] * (1 - ink) + 255 * ink
    rgb[..., 1] *= 1 - ink
    rgb[..., 2] *= 1 - ink
    DEBUG.mkdir(parents=True, exist_ok=True)
    out = DEBUG / f"{name}_overlay.jpg"
    Image.fromarray(rgb.clip(0, 255).astype(np.uint8)).save(out, quality=85)
    print(out)


if __name__ == "__main__":
    main()

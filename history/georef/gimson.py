"""APPROXIMATE placement of Gimson's bird's-eye view (design No. 15).

Gimson's plan is not digitised; the NLA holds only his two perspective views.
The lower one, a bird's-eye view of the city, is placed here by a single
perspective transform (a homography) from the drawing to the ground, which is
exact only for a true perspective of flat ground.  The far distance and the
hills cannot be placed, so the output is clipped to the foreground.

Every control point below is an interpretation of the drawing, not a measured
correspondence.  The working hypothesis (13 Nov 2026):

- The view looks south-west from above Reid and Campbell (the companion
  panorama is captioned "looking south-west", and the two views line up the
  same buildings left to right).
- The foreground water is the Molonglo reach that ran north-west from the
  Duntroon loop past St John's; the city is on its south bank.
- The large lake on the left is the loop's flooded alluvial flats; the arm
  running off to the upper left is Jerrabomberra Creek.
- The hill crowned with an acropolis-like group on the right is Camp Hill.

Expect errors of a few hundred metres, more away from the city's near edge.
Edit CONTROL and rerun to refine.

Usage: uv run python gimson.py
"""

import json
import subprocess

import cv2
import numpy as np

from plans import SRC
from sheets import WORK
from warp_plans import EPSG, OUT, TMP

FILE = "1912-design-15-gimson-views-nla.obj-233376352.tif"
NAME = "design-15-gimson-birdseye-approx"

# (what it is, drawing px x, drawing px y, MGA55 E, MGA55 N)
# Drawing pixels are in the full-resolution TIFF.  Ground positions are read
# off the georeferenced 1910 composite.
CONTROL = [
    ("city's near corner, where the front shore meets the left-hand lake = reach leaves the loop", 2807, 5738, 694611, 6091460),
    ("long bridge, city end = west arm of the loop", 2308, 5121, 694709, 6091007),
    ("long bridge, far end = east side of the loop flats", 694, 5199, 695910, 6091165),
    ("upper bridge, city end = city's south-east tip near the Jerrabomberra mouth", 2886, 4779, 694768, 6090535),
    ("upper bridge, far end = east bank of the Jerrabomberra arm", 2374, 4674, 695280, 6090220),
    ("stadium bridge, stadium end = north shore of the reach", 2833, 6236, 694256, 6091953),
    ("acropolis hill = Camp Hill", 6025, 4725, 693508, 6091157),
]

# Foreground only: the part of the drawing below the city's far edge, inside the frame.
CLIP_PX = [(320, 4650), (8150, 4650), (8150, 6720), (320, 6720)]


def main():
    src = np.float32([[c[1], c[2]] for c in CONTROL])
    dst = np.float32([[c[3], c[4]] for c in CONTROL])
    H, _ = cv2.findHomography(src, dst, 0)  # least squares over all points
    proj = cv2.perspectiveTransform(src[None], H)[0]
    res = np.hypot(*(proj - dst).T)
    for c, r in zip(CONTROL, res):
        print(f"  {r:6.0f} m  {c[0]}")
    print(f"  homography residual rms {np.sqrt((res**2).mean()):.0f} m over {len(CONTROL)} points")

    # Dense synthetic control points from the homography, so gdalwarp
    # reproduces the perspective exactly (it has no homography mode).
    (x0, y0), (x1, y1) = CLIP_PX[0], CLIP_PX[2]
    gx, gy = np.meshgrid(np.linspace(x0, x1, 12), np.linspace(y0, y1, 8))
    pts = np.float32(np.c_[gx.ravel(), gy.ravel()])
    ground = cv2.perspectiveTransform(pts[None], H)[0]
    gcps = []
    for (x, y), (e, n) in zip(pts, ground):
        gcps += ["-gcp", f"{x:.1f}", f"{y:.1f}", f"{e:.2f}", f"{n:.2f}"]
    TMP.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    vrt = TMP / f"{NAME}_gcps.vrt"
    subprocess.run(["gdal_translate", "-q", "-of", "VRT", "-a_srs", f"EPSG:{EPSG}", *gcps, str(SRC / FILE), str(vrt)], check=True)
    clip = cv2.perspectiveTransform(np.float32(CLIP_PX)[None], H)[0].tolist()
    cut = TMP / f"{NAME}_cut.geojson"
    cut.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{EPSG}"}},
                "features": [{"type": "Feature", "properties": {}, "geometry": {"type": "Polygon", "coordinates": [[*clip, clip[0]]]}}],
            }
        )
    )
    warped = TMP / f"{NAME}_warp.tif"
    warped.unlink(missing_ok=True)
    subprocess.run(
        [
            "gdalwarp",
            "-q",
            "-tps",
            "-r",
            "cubic",
            "-t_srs",
            f"EPSG:{EPSG}",
            "-tr",
            "1.5",
            "1.5",
            "-cutline",
            str(cut),
            "-crop_to_cutline",
            "-dstalpha",
            "-multi",
            "-co",
            "TILED=YES",
            "-co",
            "COMPRESS=DEFLATE",
            str(vrt),
            str(warped),
        ],
        check=True,
    )
    for suffix, args in (("mga55", ["-of", "COG", "-co", "COMPRESS=JPEG", "-co", "QUALITY=90"]),):
        out = OUT / f"{NAME}-{suffix}.tif"
        out.unlink(missing_ok=True)
        subprocess.run(["gdal_translate", "-q", *args, str(warped), str(out)], check=True)
    web = OUT / f"{NAME}-3857.tif"
    web.unlink(missing_ok=True)
    subprocess.run(
        [
            "gdalwarp",
            "-q",
            "-t_srs",
            "EPSG:3857",
            "-r",
            "cubic",
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
            str(warped),
            str(web),
        ],
        check=True,
    )
    (WORK / "debug" / "plans").mkdir(parents=True, exist_ok=True)
    print(f"  wrote {OUT / (NAME + '-mga55.tif')}")


if __name__ == "__main__":
    main()

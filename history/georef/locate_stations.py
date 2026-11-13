"""Locate trigonometrical-station symbols on the sheets.

Each station is drawn as a double ring (inside a triangle for main stations).
Starting from a rough position read off the sheet by eye, we slide a
double-ring template over the black-ink mask and take the best match, then
refine to sub-pixel with a parabolic fit of the score surface.

Rough positions are in work/sheets/sheetN.jpg pixels.  Modern GDA2020 / MGA
zone 55 coordinates come from the ACT Government survey control mark register
(ACTmapi "ACTGOV Survey Control Mark", downloaded 2026-11-13), where these
1910 stations still carry their original names.

Writes gcps/stations.csv.

Usage: uv run python locate_stations.py
"""

import csv

import numpy as np
from PIL import Image, ImageDraw

from detect_grid import ink_mask
from sheets import GCP_DIR, SHEET_DIR, SHEETS, WORK

Image.MAX_IMAGE_PIXELS = None

# name, sheet, rough px, rough py, register mark, MGA55 E, MGA55 N, register condition
STATIONS = [
    ("Ainslie", 2, 4455, 521, "AINSLIE", 696317.290, 6094875.455, "GOOD"),
    ("Black Mountain", 1, 1313, 1127, "BLACK MOUNT", 690782.310, 6094569.844, "GOOD"),
    ("Vernon", 2, 875, 2406, "VERNON", 693630.012, 6093543.498, "GOOD"),
    ("Quarry", 3, 3340, 391, "QUARRY", 692227.946, 6091838.012, "GONE"),
    ("Gap", 3, 3092, 1243, "GAP", 692030.761, 6091212.545, "GOOD"),
    ("Shale", 3, 775, 1781, "SHALE", 690308.842, 6090857.778, "GOOD"),
    ("Russell", 4, 4459, 447, "RUSSELL", 696237.031, 6091699.000, "GOOD"),
    ("Rottenbury", 4, 1900, 1703, "ROTTENBURY", 694329.773, 6090813.279, "GONE"),
    ("West of School", 4, 626, 3701, "WEST OF SCHOOL", 693348.051, 6089360.291, "GOOD"),
    # Red Hill: the register only holds RED HILL ECCE / RED HILL EAST, which
    # may not be the 1910 station.  Located for checking, not used as control.
    ("Red Hill", 3, 3218, 4275, "RED HILL ECCE", 692007.131, 6088968.355, "GOOD"),
]

R_INNER, R_OUTER = 4.0, 7.5


def ring_template(size: int = 21) -> np.ndarray:
    c = size // 2
    yy, xx = np.mgrid[:size, :size] - c
    r = np.hypot(xx, yy)
    t = np.zeros((size, size))
    t[np.abs(r - R_INNER) < 1.0] = 1.0
    t[np.abs(r - R_OUTER) < 1.0] = 1.0
    t[(r > R_INNER + 1.4) & (r < R_OUTER - 1.4)] = -1.0  # gap between rings
    t[r < R_INNER - 1.4] = -1.0  # empty centre
    return t - t.mean()


def match(mask: np.ndarray, x0: int, y0: int, search: int = 14):
    t = ring_template()
    h = t.shape[0] // 2
    sub = mask[y0 - search - h : y0 + search + h + 1, x0 - search - h : x0 + search + h + 1].astype(float)
    n = 2 * search + 1
    score = np.empty((n, n))
    for dy in range(n):
        for dx in range(n):
            score[dy, dx] = (sub[dy : dy + t.shape[0], dx : dx + t.shape[1]] * t).sum()
    j, i = np.unravel_index(score.argmax(), score.shape)

    def parab(a, b, c):
        d = a - 2 * b + c
        return 0.0 if d == 0 else 0.5 * (a - c) / d

    fx = parab(*score[j, i - 1 : i + 2]) if 0 < i < n - 1 else 0.0
    fy = parab(*score[j - 1 : j + 2, i]) if 0 < j < n - 1 else 0.0
    return x0 - search + i + fx, y0 - search + j + fy, float(score.max())


def main() -> None:
    masks = {}
    rows = []
    for name, sheet, rx, ry, mark, e, nn, cond in STATIONS:
        if sheet not in masks:
            img = Image.open(SHEET_DIR / SHEETS[sheet]["file"]).convert("RGB")
            masks[sheet] = (img, ink_mask(np.asarray(img)))
        img, mask = masks[sheet]
        px, py, s = match(mask, rx, ry)
        print(f"  {name:15s} sheet {sheet}: ({px:7.1f}, {py:7.1f})  score {s:5.1f}  moved {np.hypot(px - rx, py - ry):5.1f} px")
        rows.append([name, sheet, f"{px:.2f}", f"{py:.2f}", mark, e, nn, cond])
        crop = img.crop((int(px) - 40, int(py) - 40, int(px) + 40, int(py) + 40)).resize((240, 240), Image.LANCZOS)
        d = ImageDraw.Draw(crop)
        cx, cy = (px - int(px) + 40) * 3, (py - int(py) + 40) * 3
        d.line([cx - 30, cy, cx + 30, cy], fill=(0, 140, 255), width=1)
        d.line([cx, cy - 30, cx, cy + 30], fill=(0, 140, 255), width=1)
        (WORK / "debug" / "st").mkdir(parents=True, exist_ok=True)
        crop.save(WORK / "debug" / "st" / f"fit_{name.replace(' ', '_')}.png")

    with (GCP_DIR / "stations.csv").open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["station", "sheet", "px", "py", "register_mark", "mga55_e", "mga55_n", "register_condition"])
        w.writerows(rows)
    print("  wrote gcps/stations.csv")


if __name__ == "__main__":
    main()

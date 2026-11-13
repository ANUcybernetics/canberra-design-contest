"""Find the 1910 survey grid on the 1912 competition plans.

The lithographs (and design 10's original) are drawn on the 1910 contour
survey reduced to a single sheet, so each carries the full grid: nine
meridians (20,000 .. 0 ft west of Ainslie) and nine parallels (0 .. 20,000 ft
south), every 2,500 ft.  For each plan we:

1. Build an ink mask against the local paper tone (so photographs with uneven
   lighting work too).
2. Estimate the skew of the meridians and of the parallels separately, by
   finding the shear that makes the mask's projection sharpest.
3. Fit a comb of nine evenly spaced teeth to each deskewed projection.
4. Trace every line along its length at full resolution and fit a quadratic,
   letting poorly traced lines borrow the shape of their neighbours.
5. Intersect them, giving 81 pixel -> survey-grid control points.

Writes gcps/plans/<plan>_grid.csv and a debug overlay in work/debug/plans/.

Usage: uv run python plans.py [plan ...]
"""

import csv
import sys

import numpy as np
from PIL import Image, ImageDraw

from detect_grid import intersect, robust_quadratic
from paths import PLAN_GCP_DIR, SCANS, WORK

Image.MAX_IMAGE_PIXELS = None

SRC = SCANS / "1912-plans"
DEBUG = WORK / "debug" / "plans"
GRID_W = [20000 - 2500 * i for i in range(9)]  # left to right
GRID_S = [2500 * i for i in range(9)]  # top to bottom
BEND_PX = 6  # a crossing this far off the line through its neighbours is suspect

# rot: quarter-turns clockwise needed to bring north to the top.
PLANS = {
    "design-04-agache-sewerage": {
        "label": "No. 4 Agache (3rd): lithograph, sewerage",
        "file": "1912-design-04-agache-lithograph-sewerage-nla.obj-230049981.tif",
    },
    "design-07-magonigle": {
        "label": "No. 7 Magonigle (commended): lithograph",
        "file": "1912-design-07-magonigle-lithograph-nla.obj-230049829.tif",
    },
    "design-10-griffiths-coulter-caswell": {
        "label": "No. 10 Griffiths, Coulter & Caswell (minority 1st): original",
        "file": "1912-design-10-griffiths-coulter-caswell-original-nla.obj-230050301.tif",
    },
    "design-18-saarinen": {
        "label": "No. 18 Saarinen (2nd): lithograph",
        "file": "1912-design-18-saarinen-lithograph-nla.obj-230049189.tif",
    },
    # No grid survives on the slide: registered by match_plans.py instead.
    "design-18-saarinen-lantern-slide": {
        "label": "No. 18 Saarinen: lantern slide of original",
        "method": "match",
        "file": "1912-design-18-saarinen-lantern-slide-nla.obj-150474349.jpg",
    },
    "design-29-griffin-copyA": {
        "label": "No. 29 Griffin (1st): lithograph, copy A",
        "file": "1912-design-29-griffin-lithograph-copyA-nla.obj-245514574.jpg",
    },
    "design-29-griffin-copyB": {
        "label": "No. 29 Griffin (1st): lithograph, copy B",
        "file": "1912-design-29-griffin-lithograph-copyB-nla.obj-230572483.tif",
    },
    "design-35-schanfelberg-rees-gummer": {
        "label": "No. 35 Schanfelberg, Rees & Gummer (commended): lithograph",
        "file": "1912-design-35-schanfelberg-rees-gummer-lithograph-nla.obj-230049342.tif",
    },
    "design-37-berard": {"label": "No. 37 Bérard: streets plan", "file": "1912-design-37-berard-streets-plan-nla.obj-233375520.tif"},
    "design-41-comey": {
        "label": "No. 41 Comey (minority 2nd): lithograph",
        "file": "1912-design-41-comey-lithograph-nla.obj-230049661.tif",
        "rot": 1,
    },
    "design-81-gellerstedt": {
        "label": "No. 81 Gellerstedt (minority 3rd): lithograph",
        "file": "1912-design-81-gellerstedt-lithograph-nla.obj-230049505.tif",
    },
}


def load_gray(spec):
    img = Image.open(SRC / spec["file"])
    img.load()
    gray = img.convert("L")
    rot = spec.get("rot", 0)
    if rot:
        gray = gray.rotate(-90 * rot, expand=True)  # PIL rotates anticlockwise
    return gray, img.size


def unrotate(x, y, rot, size):
    """Upright-image pixel coords -> original file pixel coords."""
    w0, h0 = size
    for _ in range(rot % 4):
        # one clockwise quarter-turn mapped back: X = y', Y = h0 - x'
        x, y = y, h0 - x
        w0, h0 = h0, w0
    return x, y


def line_masks(gray: Image.Image, contrast: float = 18):
    """Masks of thin dark lines running vertically and horizontally.

    A pixel is on a vertical line when it is darker than the paper a few
    pixels to BOTH its left and right (and likewise above and below for a
    horizontal line).  This keeps thin ruled lines and drops broad shading,
    hatching blocks and heavy lettering better than a plain threshold.
    """
    g = np.asarray(gray, dtype=np.int16)
    k = max(3, round(max(g.shape) / 2000))
    left, right = np.roll(g, k, 1), np.roll(g, -k, 1)
    up, down = np.roll(g, k, 0), np.roll(g, -k, 0)
    v = (np.minimum(left, right) - g) > contrast
    h = (np.minimum(up, down) - g) > contrast
    return v, h


def pool(mask: np.ndarray, f: int) -> np.ndarray:
    """Block max-pool, so thin lines survive downsampling."""
    hh, ww = (mask.shape[0] // f) * f, (mask.shape[1] // f) * f
    return mask[:hh, :ww].reshape(hh // f, f, ww // f, f).any(axis=(1, 3))


SHEAR_ANGLES = np.arange(-1.5, 1.501, 0.025)  # degrees of skew tried


def best_shear(mask_small: np.ndarray, axis: int, angles=SHEAR_ANGLES):
    """Angle (deg) whose shear makes the projection along `axis` sharpest."""
    m = mask_small if axis == 0 else mask_small.T  # project onto columns
    ys, xs = np.nonzero(m)
    mid = m.shape[0] / 2
    best = (-1.0, 0.0)
    for a in angles:
        xp = np.round(xs - np.tan(np.radians(a)) * (ys - mid)).astype(np.int64)
        xp -= xp.min()
        hist = np.bincount(xp).astype(np.float64)
        score = (hist**2).sum()
        if score > best[0]:
            best = (score, a)
    return best[1]


def sheared_profile(mask_small, axis, angle):
    m = mask_small if axis == 0 else mask_small.T
    ys, xs = np.nonzero(m)
    mid = m.shape[0] / 2
    xp = np.round(xs - np.tan(np.radians(angle)) * (ys - mid)).astype(np.int64)
    prof = np.zeros(m.shape[1] + 1)
    ok = (xp >= 0) & (xp < len(prof))
    np.add.at(prof, xp[ok], 1)
    return prof, mid


def comb9(profile: np.ndarray, length: int):
    """Best nine evenly spaced peaks; spacing searched over a plausible range."""
    p = profile.astype(float)
    k = 15
    base = np.convolve(p, np.ones(k) / k, mode="same")
    p = np.clip(p - base, 0, None)
    p = np.maximum.reduce([np.roll(p, s) for s in (-1, 0, 1)])
    best = (-1.0, 0, 0.0)
    for s in np.arange(0.075 * length, 0.125 * length, 0.25):
        idx = np.arange(9) * s
        for o in range(int(len(p) - idx[-1]) - 1):
            score = p[np.round(o + idx).astype(int)].sum()
            if score > best[0]:
                best = (score, o, s)
    _, o, s = best
    return [o + i * s for i in range(9)], s


def trace(mask, predict, vertical, win=200, half=16, frac=0.4):
    """Samples (along, across) of a line whose centre is roughly predict(along)."""
    m = mask if vertical else mask.T
    out = []
    for start in range(0, m.shape[0] - win, win // 2):
        t = start + win / 2
        c0 = round(predict(t))
        lo, hi = c0 - half, c0 + half + 1
        if lo < 0 or hi > m.shape[1]:
            continue
        prof = m[start : start + win, lo:hi].sum(0)
        j = int(prof.argmax())
        if prof[j] < frac * win:
            continue
        jlo, jhi = max(j - 2, 0), min(j + 3, len(prof))
        w = prof[jlo:jhi].astype(float)
        out.append((t, lo + jlo + (w * np.arange(len(w))).sum() / w.sum()))
    return np.array(out).reshape(-1, 2)


def fit_lines(mask, approx, angle, mid, vertical, label, min_samples=10):
    traced = []
    for a in approx:
        slope = np.tan(np.radians(angle))
        traced.append(trace(mask, lambda t, a=a, slope=slope: a + slope * (t - mid), vertical))
    good = [robust_quadratic(s)[0] for s in traced if len(s) >= min_samples]
    shape = np.median(np.array(good), axis=0) if good else np.array([0.0, np.tan(np.radians(angle)), 0.0])
    fits, notes = [], []
    for a, s in zip(approx, traced):
        if len(s) >= min_samples:
            coef, _rms, k = robust_quadratic(s)
            notes.append(f"{k}")
        else:
            coef = shape.copy()
            coef[2] = 0
            coef[2] = np.median(s[:, 1] - np.polyval(coef, s[:, 0])) if len(s) else a - np.polyval(coef, mid)
            notes.append(f"{len(s)}*")
        fits.append(coef)
    print(f"  {label} samples per line: " + " ".join(notes))
    return fits


def detect(name: str) -> dict:
    spec = PLANS[name]
    gray, size = load_gray(spec)
    rot = spec.get("rot", 0)
    vmask, hmask = line_masks(gray)
    f = 4
    vsmall, hsmall = pool(vmask, f), pool(hmask, f)
    av = best_shear(vsmall, 0)
    ah = best_shear(hsmall, 1)
    pv, midv = sheared_profile(vsmall, 0, av)
    ph, midh = sheared_profile(hsmall, 1, ah)
    vx, sv = comb9(pv, vsmall.shape[1])
    hy, sh = comb9(ph, hsmall.shape[0])
    print(
        f"{name}: {gray.width}x{gray.height}, skew meridians {av:+.2f} deg, parallels {ah:+.2f} deg, spacing {sv * f:.0f}/{sh * f:.0f} px"
    )

    vfits = fit_lines(vmask, [x * f + f / 2 for x in vx], av, midv * f, True, "meridians")
    hfits = fit_lines(hmask, [y * f + f / 2 for y in hy], ah, midh * f, False, "parallels")

    pts = []
    for i, W in enumerate(GRID_W):
        for j, S in enumerate(GRID_S):
            x, y = intersect(vfits[i], hfits[j])
            pts.append((W, S, x, y))

    # Quality.  Paper and printing distort a lithograph smoothly, so a
    # crossing that is a long way off the straight line through its two
    # neighbours (along either axis) marks a mis-traced line.  The quadratic
    # residual is reported only as a measure of overall paper distortion.
    P = np.array(pts)
    G = P[:, 2:].reshape(9, 9, 2)  # [meridian i, parallel j]
    bend = np.zeros((9, 9))
    for axis in (0, 1):
        g = np.moveaxis(G, axis, 0)
        d = np.zeros((9, 9))
        d[1:-1] = np.hypot(*(g[:-2] + g[2:] - 2 * g[1:-1]).transpose(2, 0, 1)) / 2
        d[0] = np.hypot(*(g[0] - 2 * g[1] + g[2]).T) / 2  # edges: second difference inward
        d[-1] = np.hypot(*(g[-1] - 2 * g[-2] + g[-3]).T) / 2
        bend = np.maximum(bend, np.moveaxis(d, 0, axis))
    res = bend.reshape(-1)
    A = np.c_[np.ones(len(P)), P[:, 2], P[:, 3], P[:, 2] ** 2, P[:, 2] * P[:, 3], P[:, 3] ** 2]
    cw, *_ = np.linalg.lstsq(A, P[:, 0], rcond=None)
    cs, *_ = np.linalg.lstsq(A, P[:, 1], rcond=None)
    quad = np.hypot(A @ cw - P[:, 0], A @ cs - P[:, 1])
    ftpx = 2500 / np.mean([sv * f, sh * f])
    flagged = int((res > BEND_PX).sum())
    print(
        f"  {ftpx:.2f} ft/px; paper distortion beyond a quadratic: rms {np.sqrt((quad**2).mean()):.1f} ft; "
        f"bend max {res.max():.1f} px, {flagged} crossings over {BEND_PX} px"
    )

    PLAN_GCP_DIR.mkdir(parents=True, exist_ok=True)
    with (PLAN_GCP_DIR / f"{name}_grid.csv").open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["plan", "ft_west", "ft_south", "px", "py", "bend_px"])
        for (W, S, x, y), r in zip(pts, res):
            ox, oy = unrotate(x, y, rot, size)
            w.writerow([name, W, S, f"{ox:.2f}", f"{oy:.2f}", f"{r:.1f}"])

    DEBUG.mkdir(parents=True, exist_ok=True)
    dbg = gray.convert("RGB")
    d = ImageDraw.Draw(dbg)
    rad = max(8, int(0.012 * gray.width))
    for (W, S, x, y), r in zip(pts, res):
        col = (0, 150, 255) if r <= BEND_PX else (255, 40, 40)
        d.ellipse([x - rad, y - rad, x + rad, y + rad], outline=col, width=max(3, rad // 4))
    sc = 1600 / max(dbg.size)
    dbg.resize((int(dbg.width * sc), int(dbg.height * sc)), Image.LANCZOS).save(DEBUG / f"{name}.jpg", quality=85)
    return {"bend_max_px": float(res.max()), "flagged": flagged, "ftpx": float(ftpx)}


if __name__ == "__main__":
    for n in sys.argv[1:] or [p for p, spec in PLANS.items() if spec.get("method") != "match"]:
        detect(n)

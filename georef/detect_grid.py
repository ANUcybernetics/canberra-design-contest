"""Find the 2,500 ft grid intersections on each sheet scan.

For each sheet we:
1. Build a mask of black ink (dark, and not the red of the contours).
2. Find the five meridians and five parallels by fitting an evenly spaced
   comb to the mask's column / row sums.
3. Follow each line along its length in short windows, take the ink centroid
   in each window, and fit a quadratic so gentle skew or bowing in the scan is
   captured.
4. Intersect every meridian with every parallel.

Writes gcps/sheetN_grid.csv (pixel -> survey-grid feet) and a debug overlay
in work/debug/.

Usage: uv run python detect_grid.py [sheet ...]
"""

import csv
import sys

import numpy as np
from PIL import Image, ImageDraw

from paths import GCP_DIR, WORK
from sheets import SHEET_DIR, SHEETS

Image.MAX_IMAGE_PIXELS = None


def ink_mask(rgb: np.ndarray) -> np.ndarray:
    r, g, b = (rgb[..., i].astype(np.int16) for i in range(3))
    # Grid lines are thin, neutral grey-black (~140-170 on a ~215 paper tone).
    lum = (r + g + b) / 3
    dark = lum < 175
    not_red = (r - b) < 50  # red contours
    not_blue = (b - r) < 5  # blue water lines
    return dark & not_red & not_blue


def comb_fit(profile: np.ndarray, n: int = 5, spacings=range(980, 1080)) -> list[float]:
    """Best n evenly spaced peaks in a 1-D ink profile."""
    p = profile.astype(float)
    # Emphasise thin lines: subtract a broad local baseline.
    k = 61
    base = np.convolve(p, np.ones(k) / k, mode="same")
    p = np.clip(p - base, 0, None)
    # Allow +-3 px slop on each tooth.
    p = np.maximum.reduce([np.roll(p, s) for s in range(-3, 4)])
    best = (-1, None, None)
    for s in spacings:
        for o in range(len(p) - (n - 1) * s):
            score = p[[o + i * s for i in range(n)]].sum()
            if score > best[0]:
                best = (score, o, s)
    _, o, s = best
    return [o + i * s for i in range(n)]


def trace_line(mask: np.ndarray, approx: float, vertical: bool, win: int = 120, half: int = 18):
    """Return (along, across) samples of a grid line's centre."""
    m = mask if vertical else mask.T
    length = m.shape[0]
    samples = []
    centre = approx
    for start in range(0, length - win, win // 2):
        lo = round(centre) - half
        hi = round(centre) + half + 1
        if lo < 0 or hi > m.shape[1]:
            continue
        block = m[start : start + win, lo:hi]
        prof = block.sum(0)
        j = int(prof.argmax())
        # A real grid line is continuous through most of the window.
        if prof[j] < 0.6 * win:
            continue
        # Sub-pixel centroid around the peak.
        jlo, jhi = max(j - 3, 0), min(j + 4, len(prof))
        w = prof[jlo:jhi].astype(float)
        c = lo + jlo + (w * np.arange(len(w))).sum() / w.sum()
        samples.append((start + win / 2, c))
    return np.array(samples)


def robust_quadratic(samples: np.ndarray, deg: int = 2, tol: float = 2.0):
    t, c = samples[:, 0], samples[:, 1]
    keep = np.ones(len(t), bool)
    for _ in range(5):
        coef = np.polyfit(t[keep], c[keep], deg)
        resid = c - np.polyval(coef, t)
        new = np.abs(resid) < max(tol, 3 * resid[keep].std())
        if (new == keep).all():
            break
        keep = new
    rms = float(np.sqrt((resid[keep] ** 2).mean()))
    return coef, rms, int(keep.sum())


MIN_SAMPLES = 12


def fit_family(mask, approx, vertical, label):
    """Fit each line of a family; poorly traced lines borrow the family's shape.

    Grid lines on a sheet are parallel, so a line that is mostly hidden under
    lettering takes the median slope/curvature of its well-traced siblings and
    only its offset is fitted from the samples it has.
    """
    traced = [trace_line(mask, a, vertical) for a in approx]
    good = [robust_quadratic(s)[0] for s in traced if len(s) >= MIN_SAMPLES]
    shape = np.median(np.array(good), axis=0) if good else np.array([0.0, 0.0, 0.0])
    fits = []
    for a, s in zip(approx, traced):
        if len(s) >= MIN_SAMPLES:
            coef, rms, k = robust_quadratic(s)
            note = "own fit"
        else:
            coef = shape.copy()
            if len(s):
                coef[2] += np.median(s[:, 1] - np.polyval(shape, s[:, 0]))
            else:
                coef[2] += a - np.polyval(shape, mask.shape[0 if vertical else 1] / 2)
            k = len(s)
            rms = float(np.sqrt(((s[:, 1] - np.polyval(coef, s[:, 0])) ** 2).mean())) if len(s) else float("nan")
            note = "shared shape"
        print(f"  {label} ~{a:5d}: {k:3d} samples, rms {rms:.2f} px ({note})")
        fits.append(coef)
    return fits


def intersect(vcoef, hcoef):
    """Solve x = V(y), y = H(x) by fixed-point iteration."""
    y = np.polyval(hcoef, 0.0)
    for _ in range(20):
        x = np.polyval(vcoef, y)
        y = np.polyval(hcoef, x)
    return float(x), float(y)


def process(n: int) -> None:
    spec = SHEETS[n]
    img = Image.open(SHEET_DIR / spec["file"]).convert("RGB")
    rgb = np.asarray(img)
    mask = ink_mask(rgb)

    vx = comb_fit(mask.sum(0))
    hy = comb_fit(mask.sum(1))

    vfits = fit_family(mask, vx, vertical=True, label=f"sheet {n} meridian ")
    hfits = fit_family(mask, hy, vertical=False, label=f"sheet {n} parallel ")

    GCP_DIR.mkdir(exist_ok=True)
    out = GCP_DIR / f"sheet{n}_grid.csv"
    dbg = img.copy()
    draw = ImageDraw.Draw(dbg)
    with out.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["sheet", "ft_west", "ft_south", "px", "py"])
        for i, xft in enumerate(spec["xs"]):
            for j, yft in enumerate(spec["ys"]):
                px, py = intersect(vfits[i], hfits[j])
                w.writerow([n, xft, yft, f"{px:.2f}", f"{py:.2f}"])
                draw.ellipse([px - 25, py - 25, px + 25, py + 25], outline=(0, 160, 255), width=6)
                draw.text((px + 30, py + 30), f"{xft}W {yft}S", fill=(0, 120, 255))
    (WORK / "debug").mkdir(parents=True, exist_ok=True)
    dbg.resize((dbg.width // 3, dbg.height // 3)).save(WORK / "debug" / f"sheet{n}_grid.jpg", quality=85)
    print(f"  wrote {out.relative_to(GCP_DIR.parent)}")


if __name__ == "__main__":
    for arg in sys.argv[1:] or SHEETS:
        process(int(arg))

"""Register the plans that do not show the survey grid, by matching them to a
georeferenced plan of the same design.

- design-18-saarinen-lantern-slide: a photograph of Saarinen's original
  drawing; no grid survives.  Matched to Saarinen's lithograph.

Two stages, both on the drawings' linework (thin dark lines, broad tone
removed).  First a brute-force search over scale and rotation, with phase
correlation for the shift, finds a rough similarity transform; feature
matching (SIFT) proved unreliable on repetitive line drawings.  Then the
plan is correlated block by block against the reference; strong blocks
become control points (plan pixel -> MGA55), outliers are dropped against a
2nd-order polynomial, and the plan is warped with that polynomial, which is
smooth and forgiving of the odd bad match.

Writes gcps/plans/<plan>_matched.csv, then warps via warp_plans.warp().

Usage: uv run python match_plans.py [plan ...]
"""

import csv
import json
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image

from paths import PLAN_COGS, PLAN_GCP_DIR
from plans import DEBUG, SRC
from warp_plans import load_transform, warp

Image.MAX_IMAGE_PIXELS = None

MATCHED = {
    "design-18-saarinen-lantern-slide": {
        "file": "1912-design-18-saarinen-lantern-slide-nla.obj-150474349.jpg",
        "ref": "design-18-saarinen",
    },
}
# Tried and failed (13 Nov 2026); these need control points picked by hand.
# Neither shows the survey grid, and both are drawn at a different scale from
# the lithograph of the same design, so the brute-force search found no
# reliable alignment (correlation peaks of 7-8 sigma, i.e. noise):
#   design-18-saarinen-central-area   1912-design-18-saarinen-central-area-nla.obj-230049023.tif
#   design-04-agache-public-buildings 1912-design-04-agache-public-buildings-nla.obj-230050141.tif
WORK_PX = 3000  # longest side for matching


def load(path, longest=WORK_PX):
    img = Image.open(path)
    img.load()
    full = img.size
    g = img.convert("L")
    s = longest / max(full)
    g = g.resize((round(full[0] * s), round(full[1] * s)), Image.LANCZOS)
    a = np.asarray(g)
    # even out lighting so photographs and lithographs look alike
    a = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(a)
    return a, s, full


def reference(ref_name):
    """The reference plan, in MGA, as a grey array plus its geotransform."""
    tif = PLAN_COGS / f"{ref_name}-mga55.tif"
    info = json.loads(subprocess.run(["gdalinfo", "-json", str(tif)], capture_output=True, text=True, check=True).stdout)
    gt = info["geoTransform"]
    a, s, _full = load(tif)
    gt_small = [gt[0], gt[1] / s, gt[2], gt[3], gt[4], gt[5] / s]
    return a, gt_small


def line_strength(a):
    """Thin dark lines -> bright; broad tone removed (as in the QA check)."""
    f = a.astype(np.float32)
    return np.clip(cv2.blur(f, (15, 15)) - f, 0, None)


def phase(a, b):
    """Shift (dx, dy) taking a onto b, and peak strength in sigma."""
    F = np.fft.fft2(b) * np.conj(np.fft.fft2(a))
    r = np.fft.ifft2(F / (np.abs(F) + 1e-9)).real
    j, i = np.unravel_index(r.argmax(), r.shape)
    dy = j if j < r.shape[0] / 2 else j - r.shape[0]
    dx = i if i < r.shape[1] / 2 else i - r.shape[1]
    return dx, dy, r.max() / r.std()


SCALES = np.geomspace(0.15, 3.0, 91)  # target -> reference scale factors tried
ROTATIONS = np.arange(-6, 6.01, 1.0)  # degrees


def coarse(tgt, ref, scales=SCALES, rots=ROTATIONS, work=640):
    """Similarity transform target -> reference by brute-force search.

    For each scale and rotation, the target's linework is placed on a canvas
    the size of the reference's and phase-correlated with it; the strongest
    peak wins.  Done at low resolution, then returned as a 3x3 matrix at the
    resolution of the arrays passed in.
    """
    k = work / max(ref.shape)
    rs = cv2.resize(ref, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    ts = cv2.resize(tgt, None, fx=k, fy=k, interpolation=cv2.INTER_AREA)
    b = line_strength(rs)
    b -= b.mean()
    best = (-1, None)
    h, w = rs.shape
    for sc in scales:
        for rot in rots:
            M = cv2.getRotationMatrix2D((ts.shape[1] / 2, ts.shape[0] / 2), rot, sc)
            M[:, 2] += (w / 2 - ts.shape[1] / 2, h / 2 - ts.shape[0] / 2)  # centre on canvas
            wt = cv2.warpAffine(ts, M, (w, h), flags=cv2.INTER_AREA, borderValue=255)
            a = line_strength(wt)
            a -= a.mean()
            dx, dy, peak = phase(a, b)
            if peak > best[0]:
                M2 = M.copy()
                M2[:, 2] += (dx, dy)
                best = (peak, M2, sc, rot)
    peak, M, sc, rot = best
    # back to full working resolution: x_ref = M (x_tgt), both scaled by k
    S = np.diag([k, k, 1.0])
    H = np.linalg.inv(S) @ np.vstack([M, [0, 0, 1]]) @ S
    return H, peak, sc, rot


def fine(tgt, ref, H, block=256, step=128, min_peak=10.0):
    """Block-wise phase correlation of linework, after the coarse warp.

    Returns matched points (target px, reference px).
    """
    warped = cv2.warpPerspective(tgt, H, (ref.shape[1], ref.shape[0]), flags=cv2.INTER_LINEAR, borderValue=0)
    valid = cv2.warpPerspective(np.full_like(tgt, 255), H, (ref.shape[1], ref.shape[0])) > 0
    a, b = line_strength(warped), line_strength(ref)
    a[~valid] = 0
    win = np.hanning(block)[:, None] * np.hanning(block)[None, :]
    Hinv = np.linalg.inv(H)
    pts_t, pts_r = [], []
    for y in range(0, ref.shape[0] - block + 1, step):
        for x in range(0, ref.shape[1] - block + 1, step):
            if valid[y : y + block, x : x + block].mean() < 0.95:
                continue
            pa, pb = a[y : y + block, x : x + block], b[y : y + block, x : x + block]
            if pa.std() < 1 or pb.std() < 1:
                continue
            A = np.fft.fft2((pa - pa.mean()) * win)
            B = np.fft.fft2((pb - pb.mean()) * win)
            F = B * np.conj(A)
            r = np.fft.ifft2(F / (np.abs(F) + 1e-9)).real
            peak = r.max() / r.std()
            if peak < min_peak:
                continue
            j, i = np.unravel_index(r.argmax(), r.shape)
            dy = j if j < block / 2 else j - block
            dx = i if i < block / 2 else i - block

            # sub-pixel refinement
            def parab(m, c, p):
                d = m - 2 * c + p
                return 0.0 if d == 0 else 0.5 * (m - p) / d

            fx = parab(r[j, (i - 1) % block], r[j, i], r[j, (i + 1) % block])
            fy = parab(r[(j - 1) % block, i], r[j, i], r[(j + 1) % block, i])
            cx, cy = x + block / 2, y + block / 2  # centre in the reference
            # warped-target content at (cx, cy) sits at (cx + dx, cy + dy) in the reference
            src = Hinv @ np.array([cx, cy, 1.0])
            pts_t.append(src[:2] / src[2])
            pts_r.append((cx + dx + fx, cy + dy + fy))
    return np.float32(pts_t), np.float32(pts_r)


def poly2_filter(p1, p2):
    def design(p):
        x, y = p[:, 0], p[:, 1]
        return np.c_[np.ones_like(x), x, y, x * x, x * y, y * y]

    keep = np.ones(len(p1), bool)
    for _ in range(8):
        A = design(p1[keep])
        cx, *_ = np.linalg.lstsq(A, p2[keep, 0], rcond=None)
        cy, *_ = np.linalg.lstsq(A, p2[keep, 1], rcond=None)
        r = np.hypot(design(p1) @ cx - p2[:, 0], design(p1) @ cy - p2[:, 1])
        new = r < max(2.0, 3.0 * np.median(r[keep]))
        if (new == keep).all():
            break
        keep = new
    return keep, r


def match(name):
    spec = MATCHED[name]
    tgt, s_t, _full_t = load(SRC / spec["file"])
    ref, gt = reference(spec["ref"])
    H, peak, sc, rot = coarse(tgt, ref)
    print(f"{name}: coarse search: scale {sc:.3f}, rotation {rot:+.1f} deg, peak {peak:.0f} sigma")
    # Match block by block, fit a homography to the matches, and match again
    # through it.  The matches kept are the third round's, after two refinements.
    for _ in range(3):
        p1, p2 = fine(tgt, ref, H)
        if len(p1) < 8:
            break
        keep, _ = poly2_filter(p1, p2)
        H2, _ = cv2.findHomography(p1[keep], p2[keep], cv2.RANSAC, 4.0)
        if H2 is None:
            break
        H = H2
    keep, r = poly2_filter(p1, p2)
    m_per_px = abs(gt[1])
    rr = r[keep]
    print(
        f"  {len(p1)} correlated blocks, {keep.sum()} kept; poly2 residual rms {np.sqrt((rr**2).mean()) * m_per_px:.1f} m, "
        f"max {rr.max() * m_per_px:.1f} m (reference at {m_per_px:.2f} m/px)"
    )
    p1, p2 = p1[keep], p2[keep]
    E = gt[0] + p2[:, 0] * gt[1] + p2[:, 1] * gt[2]
    N = gt[3] + p2[:, 0] * gt[4] + p2[:, 1] * gt[5]
    PLAN_GCP_DIR.mkdir(parents=True, exist_ok=True)
    path = PLAN_GCP_DIR / f"{name}_matched.csv"
    with path.open("w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["plan", "px", "py", "e", "n"])
        for (x, y), e, n in zip(p1, E, N):
            w.writerow([name, f"{x / s_t:.2f}", f"{y / s_t:.2f}", f"{e:.2f}", f"{n:.2f}"])
    DEBUG.mkdir(parents=True, exist_ok=True)
    vis = cv2.cvtColor(tgt, cv2.COLOR_GRAY2BGR)
    for x, y in p1:
        cv2.circle(vis, (int(x), int(y)), 10, (255, 120, 0), 3)
    cv2.imwrite(str(DEBUG / f"{name}_matches.jpg"), cv2.resize(vis, None, fx=0.5, fy=0.5))
    return path, int(keep.sum()), float(np.sqrt((rr**2).mean()) * m_per_px)


def main(names):
    h, m = load_transform()
    for name in names:
        path, n, _rms = match(name)
        if n < 30:
            print("  too few matches to trust; not warped")
            continue
        warp(name, h, m, gcp_csv=path, method="-order 2", res=1.0)


if __name__ == "__main__":
    main(sys.argv[1:] or list(MATCHED))

"""Trace the streets of each warped 1912 plan as centrelines.

Works on the warped plans in output/plans/<plan>-mga55.tif, where every plan
already sits on the 1910 composite, so the survey's own ink can be taken out
before the streets are looked for.

For each plan:

1. Find the ink.  On the lithographs and No. 10 that is anything darker than
   the local paper; on Bérard's photograph, whose streets are pale bands on a
   dark wash, it is anything darker than the pale bands.
2. Remove the survey's ink.  The lithographers redrew the survey's contours
   by hand, so they wander a few metres from the 1910 composite.  We measure
   that wander block by block, shift the composite's ink to match, widen it a
   little and subtract it.  What is left is the designer's linework.
3. The free space between the designer's lines holds the streets, but also
   parks, open country and the insides of unclosed blocks.  Its skeleton is a
   graph; along each edge the distance to the nearest line is half the width
   of the space.
4. Keep the edges that look like streets: narrow enough, and of nearly
   constant width along their length.  Fill the short links that join two kept
   edges across an intersection, and prune the stubs.
5. Simplify and write the centrelines, each with its width in metres, to
   output/streets/<plan>.geojson (EPSG:7855), plus a debug overlay in
   work/debug/streets/.

The result is a first draft for correcting by hand in QGIS, not a finished
map.

Usage: uv run python vectorise.py [--tile E0 N0 E1 N1] [plan ...]
"""

import argparse
import json
import sys

import cv2
import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject
from rasterio.windows import from_bounds
from shapely.geometry import LineString, mapping
from skan import Skeleton
from skimage.morphology import remove_small_holes, remove_small_objects, skeletonize

from plans import PLANS
from sheets import HERE, WORK
from warp_plans import COMPOSITE, OUT

STREETS = HERE / "output" / "streets"
DEBUG = WORK / "debug" / "streets"
EPSG = 7855

# Per-plan settings.  mode "lines": streets bounded by drawn lines on paper.
# mode "bands": streets drawn as pale bands on a darker wash (Bérard).
DEFAULTS = {
    "mode": "lines",
    "ink": 28,  # grey levels darker than the local paper to count as ink
    "colour": False,  # True: drop coloured ink (No. 10's red contours, blue water)
    "survey_pad_m": 3.5,  # a plan line this close to a survey line, and parallel, is the survey
    "close_m": 3.0,  # bridge gaps this wide in the designer's lines
    "min_half_m": 5.0,  # narrowest street, as half-width (10 m wide)
    "max_half_m": 32.0,  # widest street, as half-width (~200 ft avenue)
    "max_cv": 0.25,  # largest coefficient of variation of width along an edge
    "min_piece_m2": 2500,  # enclosed free space smaller than this is a lot, not streets
    "min_group_m": 60,  # drop connected groups of street shorter than this in all
}
# Areas never traced, as (E0, N0, E1, N1) in MGA55: the survey's title block
# (top left) and NOTES panel (top right), which every plan carries.
EXCLUDE = [(689900, 6094100, 691700, 6095200), (695000, 6094380, 696300, 6095200)]
SETTINGS = {
    # Bérard's own cartouche reaches further down the sheet.
    "design-37-berard": {"mode": "bands", "band_max_m": 80.0, "exclude": [(689900, 6093400, 691750, 6095200)]},
    "design-10-griffiths-coulter-caswell": {"colour": True},
    # Saarinen's "Explanatory notes" legend, right of the plan.
    "design-18-saarinen": {"exclude": [(695750, 6092900, 696550, 6094300)]},
    # A photograph of the original, at lower resolution than the lithograph
    # of the same design; trace the lithograph instead.
    "design-18-saarinen-lantern-slide": {"skip": True},
}


def cfg(name):
    return {**DEFAULTS, **SETTINGS.get(name, {})}


# ---------------------------------------------------------------- reading


def read_plan(name, tile=None):
    src = rasterio.open(OUT / f"{name}-mga55.tif")
    win = from_bounds(*tile, src.transform).round_offsets().round_lengths() if tile else None
    rgb = src.read([1, 2, 3], window=win)
    tr = src.window_transform(win) if win else src.transform
    return np.moveaxis(rgb, 0, -1), tr


def read_survey(shape, tr):
    """The 1910 composite resampled onto the plan's own pixel grid."""
    out = np.zeros((3, *shape), np.uint8)
    with rasterio.open(COMPOSITE) as src:
        for b in range(3):
            reproject(
                rasterio.band(src, b + 1),
                out[b],
                dst_transform=tr,
                dst_crs=src.crs,
                resampling=Resampling.bilinear,
            )
    return np.moveaxis(out, 0, -1)


# ---------------------------------------------------------------- ink


def paper(lum, px_m):
    """Local paper tone: a grey closing wide enough to swallow any line."""
    k = max(3, round(12 / px_m) | 1)
    bg = cv2.morphologyEx(lum, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    return cv2.GaussianBlur(bg, (0, 0), k)


def ink_mask(rgb, px_m, threshold, drop_colour=False):
    rgb = rgb.astype(np.int16)
    lum = rgb.min(axis=2).astype(np.uint8) if not drop_colour else rgb.mean(axis=2).astype(np.uint8)
    ink = paper(lum, px_m).astype(np.int16) - lum > threshold
    if drop_colour:
        # Black ink is grey; the survey's contours are red and its water blue.
        chroma = rgb.max(axis=2) - rgb.min(axis=2)
        ink &= chroma < 40
    return ink


def survey_ink(rgb, px_m, neutral_only=False):
    """Every mark on the 1910 composite: contours, water, lettering, grid.

    With neutral_only, just the black ink (grid, lettering, trig symbols), for
    plans whose own copy of the survey kept its colours.
    """
    rgb = rgb.astype(np.int16)
    if neutral_only:
        lum = rgb.mean(axis=2).astype(np.uint8)
        chroma = rgb.max(axis=2) - rgb.min(axis=2)
        return (paper(lum, px_m).astype(np.int16) - lum > 40) & (chroma < 40)
    lum = rgb.min(axis=2).astype(np.uint8)
    return paper(lum, px_m).astype(np.int16) - lum > 25


# ---------------------------------------------------------------- alignment


def wander(survey, plan, px_m, block_m=240, step_m=120):
    """Smooth field of the plan's local shift from the survey, in pixels.

    Phase-correlates the two ink masks in overlapping blocks; blocks with a
    weak peak (mostly design, or blank) are filled from their neighbours.
    """
    b, s = int(block_m / px_m), int(step_m / px_m)
    h, w = plan.shape
    ys, xs = list(range(0, h - b + 1, s)), list(range(0, w - b + 1, s))
    if not ys or not xs:
        return np.zeros((h, w), np.float32), np.zeros((h, w), np.float32), []
    a = cv2.GaussianBlur(survey.astype(np.float32), (0, 0), 1.5)
    p = cv2.GaussianBlur(plan.astype(np.float32), (0, 0), 1.5)
    win = cv2.createHanningWindow((b, b), cv2.CV_32F)
    dx = np.full((len(ys), len(xs)), np.nan, np.float32)
    dy = dx.copy()
    for i, y in enumerate(ys):
        for j, x in enumerate(xs):
            sa, sp = a[y : y + b, x : x + b], p[y : y + b, x : x + b]
            if sa.std() < 0.02 or sp.std() < 0.02:
                continue
            (sx, sy), resp = cv2.phaseCorrelate(sa, sp, win)
            if resp > 0.08 and np.hypot(sx, sy) * px_m < 40:
                dx[i, j], dy[i, j] = sx, sy
    good = ~np.isnan(dx)
    stats = np.hypot(dx[good], dy[good]) * px_m
    if not good.any():
        return np.zeros((h, w), np.float32), np.zeros((h, w), np.float32), stats
    # Fill the gaps from the nearest good block, then smooth.
    from scipy.ndimage import distance_transform_edt, gaussian_filter

    idx = distance_transform_edt(~good, return_distances=False, return_indices=True)
    dx, dy = dx[tuple(idx)], dy[tuple(idx)]
    dx, dy = gaussian_filter(dx, 1.0), gaussian_filter(dy, 1.0)
    # Block centres -> full-resolution field.
    fx = cv2.resize(dx, (len(xs) * s, len(ys) * s), interpolation=cv2.INTER_LINEAR)
    fy = cv2.resize(dy, (len(xs) * s, len(ys) * s), interpolation=cv2.INTER_LINEAR)
    off = b // 2 - s // 2
    full_x = cv2.copyMakeBorder(fx, off, max(0, h - off - fx.shape[0]), off, max(0, w - off - fx.shape[1]), cv2.BORDER_REPLICATE)[:h, :w]
    full_y = cv2.copyMakeBorder(fy, off, max(0, h - off - fy.shape[0]), off, max(0, w - off - fy.shape[1]), cv2.BORDER_REPLICATE)[:h, :w]
    return full_x, full_y, stats


def shift_mask(mask, fx, fy):
    h, w = mask.shape
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(mask.astype(np.uint8), gx - fx, gy - fy, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT) > 0


def disk(r_px):
    r = max(1, round(r_px))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


def orientation(mask, sigma=3.0):
    """Local direction of the linework, in radians mod pi (structure tensor)."""
    f = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 1.5)
    gx = cv2.Sobel(f, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(f, cv2.CV_32F, 0, 1, ksize=3)
    jxx = cv2.GaussianBlur(gx * gx, (0, 0), sigma)
    jyy = cv2.GaussianBlur(gy * gy, (0, 0), sigma)
    jxy = cv2.GaussianBlur(gx * gy, (0, 0), sigma)
    return 0.5 * np.arctan2(2 * jxy, jxx - jyy)


def survey_like(plan_skel, survey_skel, px_m, tol_m, max_deg=25.0):
    """Plan skeleton pixels that lie along a survey line: near it and parallel.

    A designer's line that crosses a contour keeps its pixels at the crossing,
    because the two run at an angle.
    """
    from scipy.ndimage import distance_transform_edt

    dist, (iy, ix) = distance_transform_edt(~survey_skel, return_indices=True)
    near = plan_skel & (dist * px_m <= tol_m)
    tp = orientation(plan_skel)
    ts = orientation(survey_skel)
    ys, xs = np.nonzero(near)
    d = np.abs(tp[ys, xs] - ts[iy[ys, xs], ix[ys, xs]]) % np.pi
    d = np.minimum(d, np.pi - d)
    out = np.zeros_like(plan_skel)
    keep = d < np.radians(max_deg)
    out[ys[keep], xs[keep]] = True
    return out


def sample_line(x0, y0, x1, y1):
    n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    return np.linspace(y0, y1, n).round().astype(int), np.linspace(x0, x1, n).round().astype(int)


def straight_lines(ink_skel, survey, px_m, min_m=30.0, gap_m=4.0):
    """Straight runs of ink, traced across the places the survey's lines cross.

    Hough segments on the skeleton of all the plan's ink, kept if they mostly
    lie outside the survey's ink and on ink all the way.
    """
    segs = cv2.HoughLinesP(
        ink_skel.astype(np.uint8) * 255,
        rho=1,
        theta=np.pi / 360,
        threshold=int(0.6 * min_m / px_m),
        minLineLength=min_m / px_m,
        maxLineGap=gap_m / px_m,
    )
    out = []
    if segs is None:
        return out
    near_ink = cv2.dilate(ink_skel.astype(np.uint8), disk(1.5)) > 0
    for x0, y0, x1, y1 in segs.reshape(-1, 4):
        r, c = sample_line(x0, y0, x1, y1)
        if survey[r, c].mean() < 0.5 and near_ink[r, c].mean() > 0.85:
            out.append((x0, y0, x1, y1))
    return out


def link_ends(design, px_m, max_m=12.0, max_angle=30.0):
    """Join line ends that face each other across a short gap."""
    skel = skeletonize(design)
    nb = cv2.filter2D(skel.astype(np.uint8), -1, np.ones((3, 3), np.float32)) - skel
    ends = np.argwhere(skel & (nb == 1))
    if len(ends) < 2:
        return []
    # Direction each end points: away from the skeleton pixels just behind it.
    r = 6
    dirs = []
    for y, x in ends:
        win = np.argwhere(skel[max(0, y - r) : y + r + 1, max(0, x - r) : x + r + 1]) + [max(0, y - r), max(0, x - r)]
        v = np.array([y, x], float) - win.mean(axis=0)
        n = np.hypot(*v)
        dirs.append(v / n if n > 0 else v)
    dirs = np.array(dirs)
    from scipy.spatial import cKDTree

    tree = cKDTree(ends)
    cos = np.cos(np.radians(max_angle))
    links, used = [], set()
    for i, j in sorted(tree.query_pairs(max_m / px_m), key=lambda p: np.hypot(*(ends[p[0]] - ends[p[1]]))):
        if i in used or j in used:
            continue
        gap = ends[j] - ends[i]
        d = np.hypot(*gap)
        if d < 1:
            continue
        g = gap / d
        if dirs[i] @ g > cos and -(dirs[j] @ g) > cos:
            links.append((ends[i][1], ends[i][0], ends[j][1], ends[j][0]))
            used |= {i, j}
    return links


# ---------------------------------------------------------------- streets


def free_space(rgb, survey_rgb, px_m, c, log):
    """Boolean mask of open paper between the designer's lines."""
    sv = survey_ink(survey_rgb, px_m, neutral_only=c["colour"])
    if c["mode"] == "bands":
        lum = rgb.astype(np.int16).mean(axis=2).astype(np.uint8)
        # White top-hat: what is brighter than its surroundings and narrower
        # than a block.  The opening is done at quarter resolution for speed.
        small = cv2.resize(lum, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
        bg = cv2.morphologyEx(small, cv2.MORPH_OPEN, disk(c["band_max_m"] / 2 / (4 * px_m)))
        bg = cv2.GaussianBlur(cv2.resize(bg, lum.shape[::-1], interpolation=cv2.INTER_LINEAR), (0, 0), 4)
        hat = cv2.GaussianBlur(lum, (0, 0), 2.0 / px_m).astype(np.int16) - bg.astype(np.int16)
        hat = np.clip(hat, 0, 255).astype(np.uint8)
        t, _ = cv2.threshold(hat[rgb.max(axis=2) > 20], 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        log(f"  band threshold {t:.0f} grey levels above the wash")
        bright = hat > t
        # Thin dark lines (survey contours, gradient ticks) cross the pale
        # bands; close over them.
        bright = cv2.morphologyEx(bright.astype(np.uint8), cv2.MORPH_CLOSE, disk(3.0 / px_m)) > 0
        bright = cv2.morphologyEx(bright.astype(np.uint8), cv2.MORPH_OPEN, disk(3.0 / px_m)) > 0
        # Holes in a band (lettering, gradient arrows) and pale specks in the
        # wash, which is mottled.
        bright = remove_small_holes(bright, max_size=int(600 / px_m**2))
        bright = remove_small_objects(bright, max_size=int(5000 / px_m**2))
        return bright, {"survey": sv & bright, "design": ~bright}
    ink = ink_mask(rgb, px_m, c["ink"], c["colour"])
    fx, fy, stats = wander(sv, ink, px_m)
    if len(stats):
        log(f"  survey wander: {len(stats)} blocks, median {np.median(stats):.1f} m, max {stats.max():.1f} m")
    sv_al = shift_mask(sv, fx, fy)
    # Compare lines, not areas: thin both to one pixel and drop the plan's
    # pixels that run alongside a survey line.
    ink_skel = skeletonize(ink)
    sv_skel = skeletonize(sv_al)
    along = survey_like(ink_skel, sv_skel, px_m, c["survey_pad_m"])
    design = ink_skel & ~along
    # Short bits: lettering, and contour the alignment missed.
    design = remove_small_objects(design, max_size=int(6 / px_m), connectivity=2)
    th = max(2, round(1.0 / px_m))
    canvas = cv2.dilate(design.astype(np.uint8), disk(th / 2))
    # Mend what is left: join facing ends, and trace straight runs across.
    links = link_ends(canvas > 0, px_m)
    for x0, y0, x1, y1 in links:
        cv2.line(canvas, (int(x0), int(y0)), (int(x1), int(y1)), 1, th)
    sv_band = cv2.dilate(sv_skel.astype(np.uint8), disk(c["survey_pad_m"] / px_m)) > 0
    lines = straight_lines(ink_skel, along_band(along, px_m), px_m)
    for x0, y0, x1, y1 in lines:
        cv2.line(canvas, (int(x0), int(y0)), (int(x1), int(y1)), 1, th)
    design = canvas > 0
    log(
        f"  {along.sum() / max(ink_skel.sum(), 1):.0%} of the ink runs along the survey; mended with {len(links)} links and {len(lines)} straight runs"
    )
    design = cv2.morphologyEx(design.astype(np.uint8), cv2.MORPH_CLOSE, disk(c["close_m"] / px_m)) > 0
    # Lettering: compact blobs, much smaller than any block outline.
    design = remove_small_objects(design, max_size=int(150 / px_m**2))
    return ~design, {"survey": sv_band & ~design, "design": design, "ink": ink}


def along_band(along, px_m):
    return cv2.dilate(along.astype(np.uint8), disk(1.5 / px_m)) > 0


def trace(free, px_m, c):
    """Skeleton graph of the free space, split into kept and dropped edges."""
    free = cv2.morphologyEx(free.astype(np.uint8), cv2.MORPH_OPEN, disk(1.5 / px_m)) > 0
    # Enclosed pieces too small to hold a street network: lots, courtyards.
    free = remove_small_objects(free, max_size=int(c["min_piece_m2"] / px_m**2))
    dist = cv2.distanceTransform(free.astype(np.uint8), cv2.DIST_L2, 5) * px_m
    skel = skeletonize(free)
    sk = Skeleton(skel)
    edges = []
    for i in range(sk.n_paths):
        coords = sk.path_coordinates(i)
        if len(coords) < 2:
            continue
        half = dist[coords[:, 0], coords[:, 1]]
        # Ignore the ends, where the edge runs into a junction or a corner.
        n = len(half)
        core = half[n // 5 : n - n // 5] if n >= 10 else half
        edges.append(
            {
                "i": i,
                "rc": coords,
                "len_m": float(np.hypot(*np.diff(coords, axis=0).T).sum() * px_m),
                "half_m": float(np.median(core)),
                "cv": float(core.std() / max(core.mean(), 1e-6)),
                "a": int(sk.paths[i].indices[0]),
                "b": int(sk.paths[i].indices[-1]),
            }
        )
    deg = np.asarray(sk.degrees)
    # Node ids for the path ends (skan indexes skeleton pixels).
    for e in edges:
        e["deg_a"], e["deg_b"] = int(deg[e["a"]]), int(deg[e["b"]])
        streetlike = c["min_half_m"] <= e["half_m"] <= c["max_half_m"] and e["cv"] <= c["max_cv"]
        e["keep"] = streetlike and e["len_m"] >= 2.0 * e["half_m"]
    # Short links across intersections: keep if both ends meet kept edges.
    for _ in range(3):
        kept_nodes = {}
        for e in edges:
            if e["keep"]:
                kept_nodes[e["a"]] = kept_nodes.get(e["a"], 0) + 1
                kept_nodes[e["b"]] = kept_nodes.get(e["b"], 0) + 1
        changed = False
        for e in edges:
            short = not e["keep"] and e["half_m"] <= c["max_half_m"] and e["len_m"] < 4 * max(e["half_m"], 5)
            if short and e["a"] in kept_nodes and e["b"] in kept_nodes:
                e["keep"] = changed = True
        if not changed:
            break
    # Prune stubs: kept edges with a free end shorter than a few widths.
    for _ in range(3):
        cnt = {}
        for e in edges:
            if e["keep"]:
                cnt[e["a"]] = cnt.get(e["a"], 0) + 1
                cnt[e["b"]] = cnt.get(e["b"], 0) + 1
        changed = False
        for e in edges:
            if e["keep"] and (cnt[e["a"]] == 1 or cnt[e["b"]] == 1) and e["len_m"] < 3 * e["half_m"] + 10:
                e["keep"] = False
                changed = True
        if not changed:
            break
    # Isolated fragments: kept edges whose connected group is short in total.
    parent = {}

    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for e in edges:
        if e["keep"]:
            parent[find(e["a"])] = find(e["b"])
    total = {}
    for e in edges:
        if e["keep"]:
            r = find(e["a"])
            total[r] = total.get(r, 0) + e["len_m"]
    for e in edges:
        if e["keep"] and total[find(e["a"])] < c["min_group_m"]:
            e["keep"] = False
    return edges, dist


def to_features(edges, tr, name, px_m):
    feats = []
    for e in edges:
        if not e["keep"]:
            continue
        rows, cols = e["rc"][:, 0] + 0.5, e["rc"][:, 1] + 0.5
        xs, ys = rasterio.transform.xy(tr, rows, cols, offset="ul")
        line = LineString(np.column_stack([xs, ys])).simplify(1.5 * px_m)
        feats.append(
            {
                "type": "Feature",
                "geometry": mapping(line),
                "properties": {
                    "design": name,
                    "width_m": round(2 * e["half_m"], 1),
                    "length_m": round(line.length, 1),
                    "width_cv": round(e["cv"], 3),
                    "source": "auto",
                },
            }
        )
    return feats


# ---------------------------------------------------------------- debug


def overlay(rgb, layers, edges, path, scale=1.0, side=False):
    img = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR).copy()
    img = (img * 0.55 + 255 * 0.45).astype(np.uint8)
    if "survey" in layers:
        img[layers["survey"] & ~layers.get("design", np.zeros_like(layers["survey"]))] = (235, 200, 160)
    if "design" in layers:
        img[layers["design"]] = (60, 60, 60)
    for e in edges:
        pts = e["rc"][:, ::-1].astype(np.int32).reshape(-1, 1, 2)
        colour, thick = ((0, 0, 220), 3) if e["keep"] else ((150, 200, 150), 1)
        cv2.polylines(img, [pts], False, colour, thick)
    if side:
        img = np.hstack([cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), img])
    if scale != 1.0:
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 85])


# ---------------------------------------------------------------- main


def run(name, tile=None, debug_scale=None):
    c = cfg(name)
    log = print
    rgb, tr = read_plan(name, tile)
    px_m = tr.a
    log(f"{name}: {rgb.shape[1]} x {rgb.shape[0]} px at {px_m:.2f} m")
    survey = read_survey(rgb.shape[:2], tr)
    free, layers = free_space(rgb, survey, px_m, c, log)
    # Outside the plan's sheet the warp leaves black; never trace there.
    free &= rgb.max(axis=2) > 20
    inv = ~tr
    for e0, n0, e1, n1 in EXCLUDE + c.get("exclude", []):
        c0, r0 = inv * (e0, n1)
        c1, r1 = inv * (e1, n0)
        r0, r1 = max(0, int(r0)), max(0, int(np.ceil(r1)))
        c0, c1 = max(0, int(c0)), max(0, int(np.ceil(c1)))
        free[r0:r1, c0:c1] = False
    edges, _ = trace(free, px_m, c)
    feats = to_features(edges, tr, name, px_m)
    total = sum(f["properties"]["length_m"] for f in feats) / 1000
    log(f"  {len(feats)} street edges, {total:.1f} km of centreline")
    STREETS.mkdir(parents=True, exist_ok=True)
    DEBUG.mkdir(parents=True, exist_ok=True)
    suffix = "-tile" if tile else ""
    out = STREETS / f"{name}{suffix}.geojson"
    out.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{EPSG}"}},
                "features": feats,
            }
        )
    )
    scale = debug_scale or (0.6 if tile else 0.25)
    overlay(rgb, layers, edges, DEBUG / f"{name}{suffix}.jpg", scale, side=bool(tile))
    return {"edges": len(feats), "km": round(total, 1)}


def package(stats):
    """One GeoPackage, a layer per design, and a summary for git."""
    import subprocess

    gpkg = HERE / "output" / "streets-1912.gpkg"
    for n in stats:
        src = STREETS / f"{n}.geojson"
        mode = ["-update", "-overwrite"] if gpkg.exists() else []
        subprocess.run(
            ["ogr2ogr", "-q", "-f", "GPKG", *mode, "-a_srs", f"EPSG:{EPSG}", "-nln", n, str(gpkg), str(src)],
            check=True,
        )
    path = HERE / "gcps" / "plans" / "streets.json"
    old = json.loads(path.read_text()) if path.exists() else {}
    old.update(stats)
    path.write_text(json.dumps(old, indent=2) + "\n")
    print(f"wrote {gpkg.relative_to(HERE)} ({len(stats)} layers)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tile", nargs=4, type=float, metavar=("E0", "N0", "E1", "N1"))
    ap.add_argument("--debug-scale", type=float)
    ap.add_argument("plans", nargs="*")
    a = ap.parse_args()
    names = a.plans or [p for p in PLANS if (OUT / f"{p}-mga55.tif").exists() and not cfg(p).get("skip")]
    stats = {}
    for n in names:
        if n not in PLANS:
            sys.exit(f"unknown plan {n}")
        stats[n] = run(n, a.tile, a.debug_scale)
    if not a.tile:
        package(stats)

"""Turn a traced plan into the layers of a modern street map.

Reads the street centrelines from vectorise.py and the warped plan, and
writes WGS84 GeoJSON for the "styled" preview page
(preview/public/data/styled/<plan>/):

- roads.geojson: the centrelines, smoothed, each given a class by its traced
  width (boulevard, avenue, street, lane).
- water.geojson: water, found from the blue wash the designers laid along
  the water side of every shore.  Areas the wash encloses are water unless
  they are as pale as the land (islands).
- landuse.geojson: the blocks between the streets, as "park" where the block
  carries no lot lines and "urban" where it does.
- buildings.geojson: public buildings, found as compact patches of dense
  hatching.
- labels.geojson: the names lettered on the plan (LABELS below), placed by
  hand from the warped plan.

Only No. 10 has a colour wash and labels so far; for other plans the water
and labels are skipped.

Usage: uv run python mapstyle.py [plan]
"""

import json
import sys

import cv2
import numpy as np
import rasterio
from rasterio.features import rasterize, shapes
from rasterio.warp import transform_geom
from shapely.geometry import LineString, mapping, shape
from skimage.morphology import remove_small_holes, remove_small_objects

from sheets import HERE
from vectorise import EXCLUDE, STREETS, cfg, disk
from warp_plans import OUT

WEB = HERE / "preview" / "public" / "data" / "styled"
RES = 2.0  # working grid for areas, metres
GAP_M = 180  # gaps in the shore wash up to this wide are bridged
MIN_WATER_M2 = 250_000  # smaller detached water is not the river
ISLAND_M2 = 150_000  # enclosed by the shore wash and smaller than this: an island
PARK_INK = 0.07  # lot lines make a block's ink denser than this, over 40 m

# Road classes by traced width (m).  The traced width runs from line centre
# to line centre, so it is a little more than the carriageway.
CLASSES = [("lane", 0, 16), ("street", 16, 28), ("avenue", 28, 40), ("boulevard", 40, 999)]

# Names lettered on No. 10, as (text, kind, E, N) in MGA55, read off the
# warped plan.  kind: park, water, place.
LABELS = {
    "design-10-griffiths-coulter-caswell": [
        ("Recreation Ground", "park", 692797, 6094474),
        ("Gardens", "park", 692544, 6094012),
        ("Aeroplane and Military Parade Reserve", "place", 694425, 6094077),
        ("Botanical and Acclimatization Gardens", "park", 694606, 6092628),
        ("Park", "park", 695587, 6092700),
        ("Park", "park", 695765, 6092127),
        ("Spillway", "place", 690988, 6093000),
        ("Dam", "place", 690862, 6092127),
        ("Island", "place", 691893, 6092632),
        ("Island", "place", 694933, 6090791),
        ("Molonglo River", "water", 693884, 6092271),
        ("Molonglo River", "water", 691603, 6092300),
        ("Park and Gardens", "park", 693449, 6091910),
        ("Park and Garden", "park", 691784, 6091982),
        ("University Grounds", "park", 692761, 6091512),
        ("Park", "park", 693177, 6090827),
        ("Park", "park", 691567, 6090791),
        ("Golf Links", "park", 695837, 6090610),
        ("Show Ground", "park", 695257, 6091331),
        ("Baths", "place", 694987, 6090267),
        ("Cricket Ground", "park", 695366, 6089805),
        ("Stadium", "park", 695113, 6089624),
        ("Racecourse", "park", 695729, 6089443),
        ("Football Ground", "park", 695095, 6089335),
        ("Railway Station", "place", 694244, 6090248),
    ],
}


# Shorelines drawn by hand where the plan's blue wash fades, as MGA55
# polylines.  No. 10: the south shore of the middle basin, along the railway
# embankment, carries only a faint wash for about a kilometre.
SHORES = {
    "design-10-griffiths-coulter-caswell": [
        [
            (693129, 6092200),
            (693214, 6092214),
            (693443, 6092236),
            (693657, 6092243),
            (693871, 6092240),
            (694043, 6092171),
            (694200, 6092057),
            (694314, 6091971),
        ],
    ],
}


def to_wgs84(geom):
    return transform_geom("EPSG:7855", "EPSG:4326", geom, precision=7)


def write(name, kind, feats):
    d = WEB / name
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{kind}.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": feats}))
    print(f"  {kind}: {len(feats)} features")


def chaikin(coords, n=2):
    """Corner-cutting: rounds the skeleton's pixel steps into smooth curves."""
    pts = np.asarray(coords, float)
    for _ in range(n):
        if len(pts) < 3:
            break
        q = 0.75 * pts[:-1] + 0.25 * pts[1:]
        r = 0.25 * pts[:-1] + 0.75 * pts[1:]
        mid = np.empty((2 * len(q), 2))
        mid[0::2], mid[1::2] = q, r
        pts = np.vstack([pts[:1], mid, pts[-1:]])
    return pts


def road_class(w):
    return next(c for c, lo, hi in CLASSES if lo <= w < hi)


def demote_short(src, cls, lower, min_m):
    """A run of one class shorter than min_m in all drops to the class below.

    Wide open ground beside a single line can pass for a short stretch of
    boulevard; a real boulevard runs on.
    """
    ends = {}
    idx = [i for i, f in enumerate(src) if f["class"] == cls]
    parent = {i: i for i in idx}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in idx:
        cs = src[i]["coords"]
        for p in (cs[0], cs[-1]):
            key = (round(p[0] / 3), round(p[1] / 3))  # ends within ~3 m meet
            if key in ends:
                parent[find(i)] = find(ends[key])
            ends[key] = i
    total = {}
    for i in idx:
        total[find(i)] = total.get(find(i), 0) + src[i]["length"]
    for i in idx:
        if total[find(i)] < min_m:
            src[i]["class"] = lower


def roads(name, repaired=True):
    """Road features, from the repaired network (repair.py) if there is one."""
    path = STREETS / f"{name}-repaired.geojson"
    if not (repaired and path.exists()):
        path = STREETS / f"{name}.geojson"
    src = []
    for f in json.loads(path.read_text())["features"]:
        p = f["properties"]
        w = p["width_m"]
        cls = road_class(w)
        if p.get("median") == "planted":
            cls = "boulevard"  # an avenue with a planted median is the grandest street there is
        src.append({"coords": f["geometry"]["coordinates"], "width": w, "class": cls, "length": p["length_m"], "median": p.get("median")})
    demote_short([r for r in src if not r["median"]], "boulevard", "avenue", 400)
    feats, lines = [], []
    for r in src:
        # Fitted streets are already smooth; Chaikin only rounds what was traced.
        geom = LineString(chaikin(r["coords"]))
        lines.append((geom, r["width"]))
        props = {"class": r["class"], "width_m": r["width"]}
        if r["median"]:
            props["median"] = r["median"]
        feats.append({"type": "Feature", "geometry": to_wgs84(mapping(geom)), "properties": props})
    return feats, lines


def read_grid(name):
    """The plan at RES metres, as RGB, with its transform."""
    with rasterio.open(OUT / f"{name}-mga55.tif") as src:
        f = src.res[0] / RES
        h, w = int(src.height * f), int(src.width * f)
        rgb = src.read([1, 2, 3], out_shape=(3, h, w), resampling=rasterio.enums.Resampling.average)
        tr = src.transform * src.transform.scale(src.width / w, src.height / h)
    return np.moveaxis(rgb, 0, -1).astype(np.int16), tr


def ink_fraction(name, tr, shape_):
    """Fraction of each RES cell covered by black ink at full resolution."""
    with rasterio.open(OUT / f"{name}-mga55.tif") as src:
        rgb = src.read([1, 2, 3]).astype(np.int16)
        px = src.res[0]
    lum = rgb.mean(axis=0).astype(np.uint8)
    chroma = rgb.max(axis=0) - rgb.min(axis=0)
    k = max(3, round(12 / px) | 1)
    bg = cv2.GaussianBlur(cv2.morphologyEx(lum, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))), (0, 0), k)
    ink = ((bg.astype(np.int16) - lum > 40) & (chroma < 40)).astype(np.float32)
    return cv2.resize(ink, shape_[::-1], interpolation=cv2.INTER_AREA)


def polygons(mask, tr, min_m2, simplify_m=2.0, smooth=True):
    out = []
    for geom, v in shapes(mask.astype(np.uint8), mask=mask, transform=tr):
        if not v:
            continue
        g = shape(geom)
        if g.area < min_m2:
            continue
        g = g.simplify(simplify_m)
        if smooth:
            g = g.buffer(4, join_style="round").buffer(-4, join_style="round")
        if not g.is_empty:
            out.append(g)
    return out


def water(rgb, live, inner, shores=(), tr=None):
    """Water: everything the blue shore wash encloses, less the islands.

    inner is the sheet less a margin, so the bluish edge of the scan is not
    taken for water.
    """
    r, b = rgb[..., 0], rgb[..., 2]
    blue = cv2.GaussianBlur((b - r).astype(np.float32), (0, 0), 2)
    land = np.median(blue[live])
    band = blue > land + 12
    band = cv2.morphologyEx(band.astype(np.uint8), cv2.MORPH_OPEN, disk(2.5 / RES)) > 0  # thin survey lines
    band = cv2.morphologyEx(band.astype(np.uint8), cv2.MORPH_CLOSE, disk(10 / RES)) > 0
    band &= inner
    for line in shores:
        pts = np.array([(~tr) * p for p in line], np.int32).reshape(-1, 1, 2)
        canvas = band.astype(np.uint8)
        cv2.polylines(canvas, [pts], False, 1, max(2, round(10 / RES)))
        band = canvas > 0
    # Tinted buildings and odd blue lines make small patches; shores run on.
    band = remove_small_objects(band, max_size=int(15000 / RES**2))
    # Bridge the gaps in the wash (at the dam, under bridges) so it encloses.
    band = cv2.morphologyEx(band.astype(np.uint8), cv2.MORPH_CLOSE, disk(GAP_M / 2 / RES)) > 0
    # Pieces of paper the band encloses are open water, unless they are small
    # enough to be islands; the land at large is the biggest piece.
    n, lab = cv2.connectedComponents((~band & live).astype(np.uint8), connectivity=4)
    size = np.bincount(lab.ravel(), minlength=n) * RES**2
    touches_edge = np.zeros(n, bool)
    touches_edge[np.unique(lab[~inner & live])] = True
    big = np.argmax(np.where(np.arange(n) == 0, 0, size))
    wet = (size > ISLAND_M2) & ~touches_edge & (np.arange(n) != big) & (np.arange(n) != 0)
    out = band | wet[lab]
    # The river and its lakes are one system; small detached patches are
    # tinted buildings or railway yards.
    out = remove_small_objects(out, max_size=int(MIN_WATER_M2 / RES**2))
    return remove_small_holes(out, max_size=int(1500 / RES**2))


def run(name):
    print(name)
    c = cfg(name)
    road_feats, lines = roads(name)
    write(name, "roads", road_feats)
    write(name, "roads-raw", roads(name, repaired=False)[0])
    rgb, tr = read_grid(name)
    h, w = rgb.shape[:2]
    live = rgb.max(axis=2) > 20
    inv = ~tr
    for e0, n0, e1, n1 in EXCLUDE + c.get("exclude", []):
        c0, r0 = inv * (e0, n1)
        c1, r1 = inv * (e1, n0)
        live[max(0, int(r0)) : max(0, int(r1) + 1), max(0, int(c0)) : max(0, int(c1) + 1)] = False

    inner = cv2.erode(live.astype(np.uint8), disk(80 / RES)) > 0
    wet = water(rgb, live, inner, SHORES.get(name, []), tr) if c["colour"] else np.zeros((h, w), bool)
    write(name, "water", [{"type": "Feature", "geometry": to_wgs84(mapping(g)), "properties": {}} for g in polygons(wet, tr, 20000)])

    # Road area, and the extent of the city: everywhere within reach of a street.
    road_area = rasterize(((g.buffer(wd / 2, cap_style="flat"), 1) for g, wd in lines), out_shape=(h, w), transform=tr) > 0
    near = rasterize(((g.buffer(90), 1) for g, _ in lines), out_shape=(h, w), transform=tr) > 0
    extent = cv2.morphologyEx(near.astype(np.uint8), cv2.MORPH_CLOSE, disk(150 / RES)) > 0
    extent = cv2.erode(extent.astype(np.uint8), disk(60 / RES)) > 0
    blocks = extent & live & ~road_area & ~wet

    ink = ink_fraction(name, tr, (h, w))
    # Buildings: compact patches where hatching makes the ink dense.
    dense = cv2.blur(ink, (int(8 / RES), int(8 / RES))) > 0.38
    dense = cv2.morphologyEx(dense.astype(np.uint8), cv2.MORPH_OPEN, disk(3 / RES)) > 0
    dense &= blocks
    bld = []
    for g in polygons(dense, tr, 400, 1.5, smooth=False):
        if g.area / g.convex_hull.area < 0.45 or g.area > 40000:
            continue
        rect = g.minimum_rotated_rectangle
        g = rect if g.area / rect.area > 0.72 else g.buffer(3, join_style="mitre").buffer(-3, join_style="mitre").simplify(2)
        bld.append(g)
    write(name, "buildings", [{"type": "Feature", "geometry": to_wgs84(mapping(g)), "properties": {}} for g in bld])

    # Parks carry no lot lines, so little ink; measured over 40 m, away from
    # the streets' own edge lines.
    k = int(40 / RES) | 1
    wt = (blocks & ~cv2.dilate(road_area.astype(np.uint8), disk(4 / RES)).astype(bool)).astype(np.float32)
    local = cv2.blur(ink * wt, (k, k)) / np.maximum(cv2.blur(wt, (k, k)), 1e-3)
    park = blocks & (local < PARK_INK)
    park = cv2.morphologyEx(park.astype(np.uint8), cv2.MORPH_OPEN, disk(12 / RES)) > 0
    park = remove_small_objects(park, max_size=int(5000 / RES**2))
    park = remove_small_holes(park, max_size=int(3000 / RES**2)) & blocks
    urban = blocks & ~park
    landuse = []
    for kind, sel in (("park", park), ("urban", urban)):
        for g in polygons(sel, tr, 600, 2.0):
            landuse.append({"type": "Feature", "geometry": to_wgs84(mapping(g)), "properties": {"kind": kind}})
    write(name, "landuse", landuse)
    ext = polygons(extent & live, tr, 50000, 5.0)
    write(name, "extent", [{"type": "Feature", "geometry": to_wgs84(mapping(g)), "properties": {}} for g in ext])

    labels = [
        {
            "type": "Feature",
            "geometry": to_wgs84({"type": "Point", "coordinates": [e, n]}),
            "properties": {"name": t, "kind": k},
        }
        for t, k, e, n in LABELS.get(name, [])
    ]
    write(name, "labels", labels)


if __name__ == "__main__":
    for n in sys.argv[1:] or ["design-10-griffiths-coulter-caswell"]:
        run(n)

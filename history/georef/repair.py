"""Repair the street networks traced by vectorise.py.

Reads output/streets/<plan>.geojson and writes <plan>-repaired.geojson beside
it, every feature tagged with what was done to it.  Each step is plain
geometry, checked against the plan's own ink; no step asks a model.

1. Avenues.  An avenue with a planted median is traced as a ladder of small
   loops, one round each island.  Chains of small loops become one centreline
   with the avenue's full width, and the side streets are carried to it.
2. Wide roads that go nowhere.  A run of wide road (35 m or more) that ends
   in a dead end and joins the network at most once is usually open ground
   beside a single drawn line.  Walk along it and look for drawn lines
   running parallel on *both* sides; drop the run if too few are found.
3. Junctions.  A skeleton splits a crossroads into two junctions joined by a
   short link, and pulls the streets sideways as they near it.  Short links
   are merged when the streets either side line up, and each junction is
   moved to the point nearest the straight lines of the streets that meet
   there.
4. Strokes.  Edges that run on through a junction (turning less than 25°)
   are chained into the street the designer drew, and each is refitted as a
   straight line or a circular arc, split at junctions where one shape will
   not do.  A fit is kept only if it stays near the trace and clear of the
   plan's linework.  Junctions then sit where the fitted streets cross.

Usage: uv run python repair.py [plan ...]
"""

import itertools
import json
import sys

import cv2
import numpy as np
import rasterio
from scipy.optimize import least_squares
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point
from shapely.ops import polygonize, unary_union
from shapely.strtree import STRtree

from plans import PLANS
from sheets import HERE, WORK
from vectorise import (
    STREETS,
    cfg,
    free_space,
    orientation,
    read_plan,
    read_survey,
)
from warp_plans import OUT

CACHE = WORK / "repair"
DEBUG = WORK / "debug" / "repair"
EPSG = 7855

SNAP_M = 2.0  # endpoints this close are one node
WIDE_M = 35.0  # a road at least this wide is "wide"
LOOP_M2 = 3000  # faces smaller than this are islands, not blocks
TURN_DEG = 25.0  # a street runs on through a junction if it turns less than this
STEP_M = 3.0  # resampling step for fitting


# ---------------------------------------------------------------- network


class Net:
    """Nodes (id -> xy) and edges (id -> a, b, coords from a to b, width, tags)."""

    def __init__(self):
        self.nodes, self.edges, self._n, self._e = {}, {}, 0, 0

    def add_node(self, xy):
        self._n += 1
        self.nodes[self._n] = np.asarray(xy, float)
        return self._n

    def add_edge(self, a, b, coords, w, **tags):
        self._e += 1
        self.edges[self._e] = {"a": a, "b": b, "coords": np.asarray(coords, float), "w": float(w), **tags}
        return self._e

    def adj(self):
        out = {n: [] for n in self.nodes}
        for i, e in self.edges.items():
            out[e["a"]].append(i)
            out[e["b"]].append(i)
        return out

    def oriented(self, i, node):
        """An edge's coords running away from node."""
        e = self.edges[i]
        return e["coords"] if e["a"] == node else e["coords"][::-1]

    def other(self, i, node):
        e = self.edges[i]
        return e["b"] if e["a"] == node else e["a"]

    def merge_nodes(self, keep, drop):
        if keep == drop:
            return
        for e in self.edges.values():
            if e["a"] == drop:
                e["a"] = keep
            if e["b"] == drop:
                e["b"] = keep
        del self.nodes[drop]

    def sync(self):
        """Pin each edge's ends to its nodes, fading the shift in over 25 m."""
        for e in self.edges.values():
            c = e["coords"]
            if len(c) < 2:
                continue
            s = arclen(c)
            for end, node in ((0, e["a"]), (-1, e["b"])):
                d = self.nodes[node] - c[end]
                if not d.any():
                    continue
                dist = s if end == 0 else s[-1] - s
                fade = np.clip(1 - dist / 25.0, 0, 1)[:, None]
                c = c + fade * d
            c[0], c[-1] = self.nodes[e["a"]], self.nodes[e["b"]]
            e["coords"] = c

    def lines(self):
        return {i: LineString(e["coords"]) for i, e in self.edges.items() if len(e["coords"]) >= 2}


def arclen(c):
    return np.r_[0, np.cumsum(np.hypot(*np.diff(c, axis=0).T))]


def resample(c, step=STEP_M):
    s = arclen(c)
    if s[-1] < step:
        return c
    t = np.arange(0, s[-1], step)
    t = np.r_[t, s[-1]]
    return np.column_stack([np.interp(t, s, c[:, 0]), np.interp(t, s, c[:, 1])])


def end_ray(c, trim, length):
    """Point `trim` metres in from c[0], and the unit direction of the next
    `length` metres, pointing away from c[0]."""
    s = arclen(c)
    if s[-1] < 1:
        return c[0], np.array([1.0, 0.0])
    trim = min(trim, 0.4 * s[-1])
    p = np.array([np.interp(trim, s, c[:, 0]), np.interp(trim, s, c[:, 1])])
    sel = (s >= trim) & (s <= trim + length)
    pts = c[sel] if sel.sum() >= 2 else c
    d = pts[-1] - pts[0]
    if len(pts) >= 3:
        u = np.linalg.svd(pts - pts.mean(axis=0))[2][0]
        d = u if u @ d >= 0 else -u
    n = np.hypot(*d)
    return p, d / n if n else np.array([1.0, 0.0])


def load(name):
    net = Net()
    fs = json.loads((STREETS / f"{name}.geojson").read_text())["features"]
    ends = []
    for f in fs:
        c = np.asarray(f["geometry"]["coordinates"], float)
        ends += [c[0], c[-1]]
    ends = np.asarray(ends)
    # Union-find over endpoints within SNAP_M.
    parent = list(range(len(ends)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, j in cKDTree(ends).query_pairs(SNAP_M):
        parent[find(i)] = find(j)
    groups = {}
    for i in range(len(ends)):
        groups.setdefault(find(i), []).append(i)
    node_of = {}
    for members in groups.values():
        n = net.add_node(ends[members].mean(axis=0))
        for m in members:
            node_of[m] = n
    for k, f in enumerate(fs):
        a, b = node_of[2 * k], node_of[2 * k + 1]
        c = np.asarray(f["geometry"]["coordinates"], float)
        if a == b and arclen(c)[-1] < 20:
            continue  # tiny loop at one node
        net.add_edge(a, b, c, f["properties"]["width_m"], src="traced")
    net.sync()
    return net


# ---------------------------------------------------------------- the plan


class Plan:
    """The designer's linework, its direction, and the clearance from it."""

    def __init__(self, name):
        CACHE.mkdir(parents=True, exist_ok=True)
        path = CACHE / f"{name}-design.png"
        with rasterio.open(OUT / f"{name}-mga55.tif") as src:
            self.tr, self.px = src.transform, src.res[0]
        if path.exists():
            design = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE) > 0
        else:
            rgb, tr = read_plan(name)
            free, layers = free_space(rgb, read_survey(rgb.shape[:2], tr), tr.a, cfg(name), lambda *a: None)
            design = layers["design"] if "ink" in layers else ~free
            cv2.imwrite(str(path), design.astype(np.uint8) * 255)
        self.design = design
        self.clear = cv2.distanceTransform((~design).astype(np.uint8), cv2.DIST_L2, 5) * self.px
        self.theta = orientation(design)
        self.inv = ~self.tr

    def rc(self, xy):
        xy = np.atleast_2d(xy)
        c, r = self.inv * (xy[:, 0], xy[:, 1])
        h, w = self.design.shape
        return np.clip(np.asarray(r).astype(int), 0, h - 1), np.clip(np.asarray(c).astype(int), 0, w - 1)

    def clearance(self, xy):
        r, c = self.rc(xy)
        return self.clear[r, c]

    def parallel_hit(self, p, d, normal, reach):
        """Is there a drawn line, parallel to d, within reach along normal?"""
        for t in np.arange(1.0, reach, self.px * 0.7):
            r, c = self.rc(p + t * normal)
            if self.design[r[0], c[0]]:
                th = self.theta[r[0], c[0]] + np.pi / 2  # gradient -> line direction
                ang = abs(np.arctan2(d[1], d[0]) - th) % np.pi
                return min(ang, np.pi - ang) < np.radians(25)
        return False


# ---------------------------------------------------------------- 1. avenues


def avenues(net, log):
    lines = net.lines()
    ids = list(lines)
    faces = [f for f in polygonize(unary_union([lines[i] for i in ids])) if f.area < LOOP_M2]
    if not faces:
        return 0
    tree = STRtree(faces)
    parent = list(range(len(faces)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, f in enumerate(faces):
        for j in tree.query(f):
            if j > i and f.intersection(faces[j]).length > 1:
                parent[find(i)] = find(j)
    clusters = {}
    for i in range(len(faces)):
        clusters.setdefault(find(i), []).append(i)
    etree = STRtree([lines[i] for i in ids])
    done = 0
    for members in clusters.values():
        if len(members) < 2:
            continue
        u = unary_union([faces[i] for i in members])
        if u.geom_type != "Polygon":
            continue
        u = type(u)(u.exterior)
        rect = u.minimum_rotated_rectangle
        xs, ys = rect.exterior.coords.xy
        sides = sorted(np.hypot(np.diff(xs[:3]), np.diff(ys[:3])))
        short, long_ = sides[0], sides[1]
        if long_ < 3 * short or not 12 <= short <= 90:
            continue
        # The avenue's axis: centroids of the islands, binned along it.
        cent = np.array([faces[i].centroid.coords[0] for i in members])
        axis = np.linalg.svd(np.asarray(u.exterior.coords) - cent.mean(axis=0))[2][0]
        proj = (cent - cent.mean(axis=0)) @ axis
        order = np.argsort(proj)
        bins, cur = [], [order[0]]
        for k in order[1:]:
            if proj[k] - proj[cur[-1]] < 15:
                cur.append(k)
            else:
                bins.append(cur)
                cur = [k]
        bins.append(cur)
        pts = np.array([cent[b].mean(axis=0) for b in bins])
        if len(pts) < 2:
            pts = np.array([cent.mean(axis=0) - axis * long_ / 4, cent.mean(axis=0) + axis * long_ / 4])
        # An avenue is ruled or struck with compasses too: fit its axis.
        pts = axis_of(pts, short)
        # Carry the axis on to the ends of the ladder.
        ext = np.vstack([pts[0] - axis * long_, pts, pts[-1] + axis * long_])
        if (ext[-1] - ext[0]) @ axis < 0:
            ext = ext[::-1]
        centre = LineString(ext).intersection(u.buffer(2))
        if centre.geom_type != "LineString" or centre.length < 0.5 * long_:
            continue
        # The ladder's edges, and where the rest of the network meets them.
        inside = u.buffer(2.5)
        gone = [ids[k] for k in etree.query(inside) if lines[ids[k]].within(inside)]
        if not gone:
            continue
        width = short + float(np.mean([net.edges[i]["w"] for i in gone]))
        gone_nodes = {net.edges[i]["a"] for i in gone} | {net.edges[i]["b"] for i in gone}
        for i in gone:
            del net.edges[i]
        adj = net.adj()
        joins = [n for n in gone_nodes if adj.get(n)]
        for n in gone_nodes:
            if not adj.get(n):
                net.nodes.pop(n, None)
        # Carry each side street to the centreline, merging those that meet it
        # within 6 m of each other.
        stops = sorted((centre.project(Point(net.nodes[n])), n) for n in joins)
        merged = []
        for s, n in stops:
            if merged and s - merged[-1][0] < 6:
                net.merge_nodes(merged[-1][1], n)
            else:
                merged.append((s, n))
        for s, n in merged:
            net.nodes[n] = np.asarray(centre.interpolate(s).coords[0])
        if len(merged) < 2:
            continue
        for (s0, n0), (s1, n1) in itertools.pairwise(merged):
            seg = [centre.interpolate(t).coords[0] for t in np.linspace(s0, s1, max(2, int((s1 - s0) / STEP_M)))]
            net.add_edge(n0, n1, seg, width, src="avenue", median="planted", islands=len(members))
        done += 1
    net.sync()
    log(f"  avenues: {done} ladders of loops made single avenues")
    return done


def axis_of(pts, width):
    """The islands' centres replaced by a fitted line or arc through them."""
    s = arclen(pts)
    t = np.linspace(0, s[-1], max(2, int(s[-1] / STEP_M)))
    dense = np.column_stack([np.interp(t, s, pts[:, 0]), np.interp(t, s, pts[:, 1])])
    line, r = fit_line(dense)
    best, rms = line, float(np.sqrt(np.mean(r**2)))
    if len(pts) >= 3:
        arc, ra = fit_arc(dense)
        if arc["R"] < 5000 and np.sqrt(np.mean(ra**2)) < 0.6 * rms:
            best, rms = arc, float(np.sqrt(np.mean(ra**2)))
    if rms > 0.25 * width:
        return pts  # neither holds: keep the islands' own line
    a, b = project(best, pts[0]), project(best, pts[-1])
    return sample(best, a, b, project(best, pts[len(pts) // 2]))


# ---------------------------------------------------------------- 2. wide roads


def wide_nowhere(net, plan, log, min_score=0.4):
    adj = net.adj()
    deg = {n: len(v) for n, v in adj.items()}
    wide = {i for i, e in net.edges.items() if e["w"] >= WIDE_M}
    seen, dropped, kept = set(), 0, 0
    for start in wide:
        if start in seen:
            continue
        run, stack = set(), [start]
        while stack:  # connected run of wide edges
            i = stack.pop()
            if i in run:
                continue
            run.add(i)
            for n in (net.edges[i]["a"], net.edges[i]["b"]):
                stack += [j for j in adj[n] if j in wide and j not in run]
        seen |= run
        nodes = {net.edges[i]["a"] for i in run} | {net.edges[i]["b"] for i in run}
        inner = {n: sum(1 for j in adj[n] if j in run) for n in nodes}
        dead = [n for n in nodes if deg[n] == 1]
        attach = [n for n in nodes if deg[n] > inner[n]]
        if not dead or len(attach) > 1:
            continue
        # Walk the run: drawn lines parallel on both sides?
        hits = total = 0
        for i in run:
            e = net.edges[i]
            c = resample(e["coords"], 8.0)
            reach = 0.75 * e["w"] + 8
            for k in range(1, len(c) - 1):
                d = c[k + 1] - c[k - 1]
                d /= np.hypot(*d) or 1
                nrm = np.array([-d[1], d[0]])
                total += 1
                hits += plan.parallel_hit(c[k], d, nrm, reach) and plan.parallel_hit(c[k], d, -nrm, reach)
        score = hits / total if total else 0
        if score < min_score:
            for i in run:
                del net.edges[i]
            dropped += 1
        else:
            kept += 1
    for n in [n for n, v in net.adj().items() if not v]:
        del net.nodes[n]
    log(f"  wide roads going nowhere: {dropped} dropped, {kept} kept (drawn lines on both sides)")
    return dropped


# ---------------------------------------------------------------- 3. junctions


def merge_links(net, log):
    merged = 0
    changed = True
    while changed:
        changed = False
        adj = net.adj()
        for i, e in sorted(net.edges.items(), key=lambda kv: arclen(kv[1]["coords"])[-1]):
            a, b = e["a"], e["b"]
            if a == b or len(adj[a]) < 3 or len(adj[b]) < 3:
                continue
            L = arclen(e["coords"])[-1]
            wmax = max(net.edges[j]["w"] for j in adj[a] + adj[b] if j != i)
            if L > wmax:
                continue
            if L > 0.5 * wmax and not lines_up(net, i, a, b, adj):
                continue  # a staggered junction, really two
            del net.edges[i]
            net.nodes[a] = (net.nodes[a] + net.nodes[b]) / 2
            net.merge_nodes(a, b)
            merged += 1
            changed = True
            break
    net.sync()
    log(f"  junctions: {merged} split crossroads merged")
    return merged


def lines_up(net, link, a, b, adj):
    """Do two streets, one at each end of the link, run on as one line?"""
    for i in adj[a]:
        if i == link:
            continue
        pa, da = end_ray(net.oriented(i, a), 0, 30)
        for j in adj[b]:
            if j == link:
                continue
            pb, db = end_ray(net.oriented(j, b), 0, 30)
            if da @ db < -np.cos(np.radians(TURN_DEG)):
                v = pb - pa
                off = abs(da[0] * v[1] - da[1] * v[0])
                if off < 0.5 * min(net.edges[i]["w"], net.edges[j]["w"]):
                    return True
    return False


def place_junctions(net, log):
    adj = net.adj()
    moved = 0
    for n, inc in adj.items():
        if len(inc) < 3:
            continue
        wmax = max(net.edges[i]["w"] for i in inc)
        rays = [end_ray(net.oriented(i, n), 0.5 * wmax + 3, 40) for i in inc]
        A = np.zeros((2, 2))
        rhs = np.zeros(2)
        for p, d in rays:
            P = np.eye(2) - np.outer(d, d)
            A += P
            rhs += P @ p
        if np.linalg.cond(A) > 1e3:
            continue
        x = np.linalg.solve(A, rhs)
        if np.hypot(*(x - net.nodes[n])) < wmax:
            net.nodes[n] = x
            moved += 1
            # Straighten the trimmed stretch onto the new junction.
            for i, (p, _) in zip(inc, rays):
                c = net.oriented(i, n)
                s = arclen(c)
                keep = c[s > np.hypot(*(p - c[0]))] if s[-1] > 1 else c
                c2 = np.vstack([x, keep]) if len(keep) else np.vstack([x, c[-1]])
                e = net.edges[i]
                e["coords"] = c2 if e["a"] == n else c2[::-1]
    net.sync()
    log(f"  junctions: {moved} moved to where their streets meet")
    return moved


# ---------------------------------------------------------------- 4. strokes


def strokes(net):
    """Chains of edges that run on through junctions."""
    adj = net.adj()
    partner = {}
    for n, inc in adj.items():
        if len(inc) < 2:
            continue
        rays = {i: end_ray(net.oriented(i, n), 0.5 * net.edges[i]["w"], 40)[1] for i in inc if net.edges[i]["a"] != net.edges[i]["b"]}
        pairs = sorted(
            ((float(rays[i] @ rays[j]), i, j) for k, i in enumerate(rays) for j in list(rays)[k + 1 :]),
        )
        for dot, i, j in pairs:
            if dot > -np.cos(np.radians(TURN_DEG)):
                break
            if (n, i) not in partner and (n, j) not in partner:
                partner[(n, i)], partner[(n, j)] = j, i
    out, used = [], set()
    for i in net.edges:
        if i in used or net.edges[i]["a"] == net.edges[i]["b"]:
            continue
        # Walk back from edge i to the end of its chain (or round a ring).
        node, edge, ring = net.edges[i]["a"], i, False
        for _ in range(10000):
            nxt = partner.get((node, edge))
            if nxt is None:
                break
            if nxt == i:
                ring = True
                break
            node, edge = net.other(nxt, node), nxt
        if ring:
            node, edge = net.edges[i]["a"], i
        # Then forward, collecting (edge, from node, to node).
        chain, at, cur = [], node, edge
        while cur is not None and cur not in used:
            used.add(cur)
            to = net.other(cur, at)
            chain.append((cur, at, to))
            cur, at = partner.get((to, cur)), to
        if chain:
            out.append(chain)
    return out


def fit_line(p):
    m = p.mean(axis=0)
    d = np.linalg.svd(p - m)[2][0]
    r = (p - m) @ np.array([-d[1], d[0]])
    return {"kind": "line", "m": m, "d": d}, r


def fit_arc(p):
    x, y = p[:, 0] - p[:, 0].mean(), p[:, 1] - p[:, 1].mean()
    A = np.column_stack([x, y, np.ones_like(x)])
    sol, *_ = np.linalg.lstsq(A, x**2 + y**2, rcond=None)
    cx, cy = sol[0] / 2, sol[1] / 2
    R = np.sqrt(max(sol[2] + cx**2 + cy**2, 1e-9))
    c = np.array([cx + p[:, 0].mean(), cy + p[:, 1].mean()])
    res = least_squares(lambda q: np.hypot(p[:, 0] - q[0], p[:, 1] - q[1]) - q[2], [c[0], c[1], R])
    c, R = res.x[:2], abs(res.x[2])
    return {"kind": "arc", "c": c, "R": R}, np.hypot(*(p - c).T) - R


def project(prim, x):
    if prim["kind"] == "line":
        return prim["m"] + ((x - prim["m"]) @ prim["d"]) * prim["d"]
    v = x - prim["c"]
    return prim["c"] + prim["R"] * v / (np.hypot(*v) or 1)


def dist(prim, x):
    return np.hypot(*(project(prim, x) - x))


def sample(prim, a, b, ref_mid):
    """The primitive from a to b (both on it), via the side nearer ref_mid."""
    if prim["kind"] == "line":
        n = max(2, int(np.hypot(*(b - a)) / STEP_M) + 1)
        return np.linspace(a, b, n)
    c, R = prim["c"], prim["R"]
    t0, t1 = np.arctan2(*(a - c)[::-1]), np.arctan2(*(b - c)[::-1])
    opts = []
    for dt in ((t1 - t0) % (2 * np.pi), (t1 - t0) % (2 * np.pi) - 2 * np.pi):
        tm = t0 + dt / 2
        opts.append((np.hypot(*(c + R * np.array([np.cos(tm), np.sin(tm)]) - ref_mid)), dt))
    dt = min(opts)[1]
    n = max(2, int(abs(dt) * R / STEP_M) + 1)
    t = t0 + np.linspace(0, dt, n)
    return c + R * np.column_stack([np.cos(t), np.sin(t)])


def try_fit(net, plan, chain):
    """Best line or arc through a chain of edges, if it holds."""
    pts = np.vstack([resample(net.oriented(i, a)) for i, a, _ in chain])
    w = float(np.median([net.edges[i]["w"] for i, _, _ in chain]))
    best = None
    length = arclen(pts)[-1]
    for f in (fit_line, fit_arc):
        prim, r = f(pts)
        if prim["kind"] == "arc" and (prim["R"] > 5000 or prim["R"] < w or length < 60):
            continue
        rms, mx = float(np.sqrt(np.mean(r**2))), float(np.abs(r).max())
        holds = rms <= max(1.5, 0.08 * w) and mx <= max(5.0, 0.3 * w)
        # An arc has one more degree of freedom, so always fits a little
        # better; prefer the straight line unless the arc is much better.
        if holds and (best is None or rms < 0.6 * best[1]):
            best = (prim, rms)
    if best is None:
        return None
    prim = best[0]
    # Stay clear of the plan's linework: the fitted street must keep a third
    # of its half-width from any drawn line along nearly all its length.
    on = np.array([project(prim, p) for p in pts])
    clear = plan.clearance(on)
    if np.mean(clear >= 0.3 * w / 2) < 0.9:
        return None
    return prim


def fit_chain(net, plan, chain, depth=0):
    """Fit the whole chain, or split it at its worst junction and try again."""
    prim = try_fit(net, plan, chain)
    if prim is not None:
        return [(chain, prim)]
    if len(chain) < 2 or depth > 5:
        return []
    k = len(chain) // 2
    return fit_chain(net, plan, chain[:k], depth + 1) + fit_chain(net, plan, chain[k:], depth + 1)


def fit_strokes(net, plan, log):
    fitted = []
    for chain in strokes(net):
        fitted += fit_chain(net, plan, chain)
    # Where does each node have to sit?  On every fitted street through it.
    on = {}
    for chain, prim in fitted:
        for i, a, b in chain:
            on.setdefault(a, []).append(prim)
            on.setdefault(b, []).append(prim)
    adj = net.adj()
    for n, prims in on.items():
        x0 = net.nodes[n]
        uniq = []
        for p in prims:
            if not any(p is q for q in uniq):
                uniq.append(p)
        if len(uniq) == 1:
            x = project(uniq[0], x0)
        else:
            x = least_squares(lambda x, uniq=uniq: [dist(p, x) for p in uniq], x0).x
        w = max(net.edges[i]["w"] for i in adj[n]) if adj[n] else 10
        if np.hypot(*(x - x0)) < max(8.0, 0.5 * w):
            net.nodes[n] = x
    km = {"line": 0.0, "arc": 0.0}
    for chain, prim in fitted:
        for i, a, b in chain:
            e = net.edges[i]
            pa, pb = project(prim, net.nodes[a]), project(prim, net.nodes[b])
            mid = e["coords"][len(e["coords"]) // 2]
            c = sample(prim, pa, pb, mid)
            c[0], c[-1] = net.nodes[a], net.nodes[b]
            e["coords"] = c if e["a"] == a else c[::-1]
            e["fit"] = prim["kind"]
            km[prim["kind"]] += arclen(c)[-1] / 1000
    net.sync()
    total = sum(arclen(e["coords"])[-1] for e in net.edges.values()) / 1000
    log(f"  strokes: {len(fitted)} fitted, {km['line']:.0f} km as straight lines and {km['arc']:.0f} km as arcs, of {total:.0f} km")
    return fitted


# ---------------------------------------------------------------- measures


def measures(net):
    adj = net.adj()
    turn = length = 0.0
    for e in net.edges.values():
        c = resample(e["coords"], 5.0)
        if len(c) < 3:
            continue
        d = np.diff(c, axis=0)
        a = np.arctan2(d[:, 1], d[:, 0])
        da = np.abs((np.diff(a) + np.pi) % (2 * np.pi) - np.pi)
        turn += np.degrees(da).sum()
        length += arclen(c)[-1]
    return {
        "edges": len(net.edges),
        "km": round(length / 1000, 1),
        "dead_ends": sum(1 for v in adj.values() if len(v) == 1),
        "junctions": sum(1 for v in adj.values() if len(v) >= 3),
        "turning_deg_per_km": round(turn / (length / 1000), 0) if length else 0,
    }


def write(net, name):
    feats = []
    for e in net.edges.values():
        c = e["coords"]
        if len(c) < 2 or arclen(c)[-1] < 1:
            continue
        props = {"design": name, "width_m": round(e["w"], 1), "length_m": round(float(arclen(c)[-1]), 1), "source": e.get("src", "traced")}
        for k in ("fit", "median", "islands"):
            if k in e:
                props[k] = e[k]
        feats.append({"type": "Feature", "geometry": {"type": "LineString", "coordinates": np.round(c, 2).tolist()}, "properties": props})
    out = STREETS / f"{name}-repaired.geojson"
    out.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "crs": {"type": "name", "properties": {"name": f"urn:ogc:def:crs:EPSG::{EPSG}"}},
                "features": feats,
            }
        )
    )
    return out


def run(name):
    log = print
    log(name)
    net = load(name)
    before = measures(net)
    plan = Plan(name)
    steps = {
        "avenues": avenues(net, log),
        "wide_dropped": wide_nowhere(net, plan, log),
        "links_merged": merge_links(net, log),
        "junctions_moved": place_junctions(net, log),
    }
    steps["strokes_fitted"] = len(fit_strokes(net, plan, log))
    after = measures(net)
    write(net, name)
    log(f"  before: {before}")
    log(f"  after:  {after}")
    return {"before": before, "after": after, "steps": steps}


COLOURS = {"avenue": (40, 160, 40), "line": (0, 0, 220), "arc": (200, 0, 160), "traced": (255, 110, 0)}


def compare(name, sites, half=130, size=520):
    """Before (left) and after (right) at each site, over the plan.

    After: avenues green, streets refitted as lines red, as arcs purple,
    untouched blue.  Ends of edges are dots.
    """
    from rasterio.windows import from_bounds

    def feats(path):
        return [f for f in json.loads(path.read_text())["features"]]

    before, after = feats(STREETS / f"{name}.geojson"), feats(STREETS / f"{name}-repaired.geojson")
    src = rasterio.open(OUT / f"{name}-mga55.tif")
    rows = []
    for cx, cy in sites:
        b = (cx - half, cy - half, cx + half, cy + half)
        win = from_bounds(*b, src.transform)
        base = np.moveaxis(src.read([1, 2, 3], window=win, out_shape=(3, size, size), boundless=True), 0, -1)[..., ::-1]
        base = (base * 0.75 + 255 * 0.25).astype(np.uint8)
        tr = src.window_transform(win) * src.window_transform(win).scale(win.width / size, win.height / size)
        inv = ~tr
        panels = []
        for fs, coloured in ((before, False), (after, True)):
            img = base.copy()
            for f in fs:
                c = np.asarray(f["geometry"]["coordinates"])
                if c[:, 0].max() < b[0] or c[:, 0].min() > b[2] or c[:, 1].max() < b[1] or c[:, 1].min() > b[3]:
                    continue
                p = f["properties"]
                key = "avenue" if p.get("source") == "avenue" else p.get("fit", "traced")
                col = COLOURS[key] if coloured else COLOURS["traced"]
                px = np.array([inv * tuple(q) for q in c]).astype(np.int32).reshape(-1, 1, 2)
                cv2.polylines(img, [px], False, col, 3 if key == "avenue" else 2, cv2.LINE_AA)
                for q in (px[0, 0], px[-1, 0]):
                    cv2.circle(img, (int(q[0]), int(q[1])), 3, (0, 0, 0), -1)
            panels.append(img)
        rows.append(np.hstack([panels[0], np.full((size, 8, 3), 255, np.uint8), panels[1]]))
    DEBUG.mkdir(parents=True, exist_ok=True)
    out = DEBUG / f"{name}-compare.jpg"
    cv2.imwrite(
        str(out), np.vstack([np.vstack([r, np.full((8, r.shape[1], 3), 255, np.uint8)]) for r in rows]), [cv2.IMWRITE_JPEG_QUALITY, 85]
    )
    return out


if __name__ == "__main__":
    if sys.argv[1:2] == ["--compare"]:
        name = sys.argv[2]
        sites = [tuple(map(float, s.split(","))) for s in sys.argv[3:]]
        print(compare(name, sites))
        sys.exit()
    names = sys.argv[1:] or [p for p in PLANS if (STREETS / f"{p}.geojson").exists()]
    path = HERE / "gcps" / "plans" / "repair.json"
    stats = json.loads(path.read_text()) if path.exists() else {}
    for n in names:
        stats[n] = run(n)
    path.write_text(json.dumps(stats, indent=2) + "\n")
    # Repaired layers beside the traced ones in the GeoPackage.
    import subprocess

    gpkg = HERE / "output" / "streets-1912.gpkg"
    for n in names:
        mode = ["-update", "-overwrite"] if gpkg.exists() else []
        src = STREETS / f"{n}-repaired.geojson"
        subprocess.run(
            ["ogr2ogr", "-q", "-f", "GPKG", *mode, "-a_srs", f"EPSG:{EPSG}", "-nln", f"{n}-repaired", str(gpkg), str(src)], check=True
        )

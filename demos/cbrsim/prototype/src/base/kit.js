// Geometry kit: a batched mesh builder and a handful of Mediterranean pieces
// (walled block, cornice, hip/gable/pyramid roofs, drum, dome, campanile, palazzo),
// plus Perlin-displaced lumps and limbs for instanced trees and rocks.
// Buildings are merged into per-tile batches so the city is a few hundred draw calls.
import { perlin } from './noise.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const UP = [0, 1, 0], DOWN = [0, -1, 0];
export const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * k))));

export class Builder {
  constructor() { this.p = []; this.n = []; this.t = []; this.c = []; this.i = []; }
  get vc() { return this.p.length / 3; }
  v(p, n, uv, col) {
    this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]);
    this.t.push(uv[0], uv[1]); this.c.push(col[0], col[1], col[2], 255);
    return this.vc - 1;
  }
  // Flat convex polygon. `hint` is the direction the face should look; winding is fixed to match.
  // col: [r,g,b] or (vertex) => [r,g,b].  uvs: explicit [[u,v]...], {plane: metres} (u along the
  // first edge) or {xz: metres} (world-projected, so overlapping strips don't flicker).
  poly(pts, col, hint, uvs) {
    let n = [0, 0, 0];
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    n = norm(n);
    if (hint && dot(n, hint) < 0) { pts = [...pts].reverse(); if (Array.isArray(uvs)) uvs = [...uvs].reverse(); n = n.map((v) => -v); }
    let uv = Array.isArray(uvs) ? uvs : null;
    if (uvs?.plane) {
      const t = norm(sub(pts[1], pts[0])), s = cross(n, t);
      uv = pts.map((p) => [dot(p, t) / uvs.plane, dot(p, s) / uvs.plane]);
    } else if (uvs?.xz) uv = pts.map((p) => [p[0] / uvs.xz, p[2] / uvs.xz]);
    const b = this.vc;
    pts.forEach((p, k) => this.v(p, n, uv ? uv[k] : [0, 0], typeof col === 'function' ? col(p) : col));
    for (let k = 1; k < pts.length - 1; k++) this.i.push(b, b + k, b + k + 1);
  }
}

// Per-tile, per-kind batches.
export class Batches {
  constructor(tile = 1000) { this.tile = tile; this.map = new Map(); }
  get(kind, x, z) {
    const tx = Math.floor(x / this.tile), tz = Math.floor(z / this.tile), key = `${kind}:${tx}:${tz}`;
    if (!this.map.has(key)) this.map.set(key, { kind, b: new Builder(), cx: (tx + 0.5) * this.tile, cz: (tz + 0.5) * this.tile });
    return this.map.get(key).b;
  }
}

export function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const jitter = (c, amt, r) => shade(c, 1 + (r() * 2 - 1) * amt);

export const STONE = [236, 226, 204], TERRACOTTA = [196, 96, 62], GOLD = [230, 180, 80];
export const STOREY = 3.4, BAY = 4;

// Rectangle footprint: centre, angle, width along local x, depth along local z -> [[x,z] x4]
export function rect(cx, cz, a, w, d) {
  const c = Math.cos(a), s = Math.sin(a);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [cx + u * c - v * s, cz + u * s + v * c]);
}
const centroid = (poly) => poly.reduce((m, p) => [m[0] + p[0] / poly.length, m[1] + p[1] / poly.length], [0, 0]);

// Vertical walls round a footprint from y0 to y1. The facade texture repeats per bay and
// storey counted from ground level g (image top = top of storey). Vertex colour darkens
// towards the foot, a cheap weathering/damp gradient.
export function walls(b, poly, y0, y1, g, col, bay = BAY, storey = STOREY, grime = 0.8) {
  const [cx, cz] = centroid(poly);
  const tint = grime === 1 ? col : (p) => shade(col, grime + (1 - grime) * Math.min(1, Math.max(0, (p[1] - g) / 6)));
  for (let k = 0; k < poly.length; k++) {
    const A = poly[k], B = poly[(k + 1) % poly.length];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const u1 = Math.max(1, Math.round(len / bay));
    const v0 = (y0 - g) / storey, v1 = (y1 - g) / storey;
    b.poly([[A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]]], tint,
      [(A[0] + B[0]) / 2 - cx, 0, (A[1] + B[1]) / 2 - cz], [[0, -v0], [u1, -v0], [u1, -v1], [0, -v1]]);
  }
}
export function cap(b, poly, y, col, uvs) {
  b.poly(poly.map(([x, z]) => [x, y, z]), col, UP, uvs);
}
// A projecting cornice band just under the eaves: outer face plus soffit.
export function cornice(b, cx, cz, a, w, d, y, h, out, col) {
  const inner = rect(cx, cz, a, w, d), outer = rect(cx, cz, a, w + out * 2, d + out * 2);
  walls(b, outer, y - h, y, y - h, col, 99, 99, 1);
  const under = shade(col, 0.75);
  for (let k = 0; k < 4; k++) {
    const A = inner[k], B = inner[(k + 1) % 4], C = outer[(k + 1) % 4], D = outer[k];
    b.poly([[A[0], y - h, A[1]], [B[0], y - h, B[1]], [C[0], y - h, C[1]], [D[0], y - h, D[1]]], under, DOWN);
  }
}

// Roofs on a rect(cx,cz,a,w,d) footprint, tile texture laid along the eaves.
const TILE = { plane: 2.8 };
export function hipRoof(b, cx, cz, a, w, d, y, rise, col, over = 0.6) {
  w += over * 2; d += over * 2;
  const c = Math.cos(a), s = Math.sin(a);
  const T = (u, yy, v) => [cx + u * c - v * s, yy, cz + u * s + v * c];
  const long = w >= d, half = (long ? d : w) / 2, r = Math.max(0, (long ? w : d) / 2 - half);
  const E = [T(-w / 2, y, -d / 2), T(w / 2, y, -d / 2), T(w / 2, y, d / 2), T(-w / 2, y, d / 2)];
  const R = long ? [T(-r, y + rise, 0), T(r, y + rise, 0)] : [T(0, y + rise, -r), T(0, y + rise, r)];
  const out = (p) => [p[0] - cx, 0.5, p[2] - cz];
  if (long) {
    b.poly([E[0], E[1], R[1], R[0]], col, out(T(0, 0, -1)), TILE);
    b.poly([E[2], E[3], R[0], R[1]], col, out(T(0, 0, 1)), TILE);
    b.poly([E[1], E[2], R[1]], col, out(T(1, 0, 0)), TILE);
    b.poly([E[3], E[0], R[0]], col, out(T(-1, 0, 0)), TILE);
  } else {
    b.poly([E[1], E[2], R[1], R[0]], col, out(T(1, 0, 0)), TILE);
    b.poly([E[3], E[0], R[0], R[1]], col, out(T(-1, 0, 0)), TILE);
    b.poly([E[0], E[1], R[0]], col, out(T(0, 0, -1)), TILE);
    b.poly([E[2], E[3], R[1]], col, out(T(0, 0, 1)), TILE);
  }
}
// Gable roof; the gable-end triangles go to `gableB` (plain stone).
export function gableRoof(b, gableB, cx, cz, a, w, d, y, rise, col, wallCol) {
  const c = Math.cos(a), s = Math.sin(a), o = 0.5;
  const T = (u, yy, v) => [cx + u * c - v * s, yy, cz + u * s + v * c];
  const A = T(-w / 2 - o, y, -d / 2 - o), B = T(w / 2 + o, y, -d / 2 - o), C = T(w / 2 + o, y, d / 2 + o), D = T(-w / 2 - o, y, d / 2 + o);
  const R0 = T(-w / 2 - o, y + rise, 0), R1 = T(w / 2 + o, y + rise, 0);
  const out = (u, v) => { const p = T(u, 0, v); return [p[0] - cx, 0.6, p[2] - cz]; };
  b.poly([A, B, R1, R0], col, out(0, -1), TILE);
  b.poly([C, D, R0, R1], col, out(0, 1), TILE);
  gableB.poly([T(w / 2, y, -d / 2), T(w / 2, y, d / 2), T(w / 2, y + rise, 0)], wallCol, out(1, 0));
  gableB.poly([T(-w / 2, y, d / 2), T(-w / 2, y, -d / 2), T(-w / 2, y + rise, 0)], wallCol, out(-1, 0));
}
export function pyramid(b, poly, y, rise, col) {
  const [cx, cz] = centroid(poly), apex = [cx, y + rise, cz];
  for (let k = 0; k < poly.length; k++) {
    const A = poly[k], B = poly[(k + 1) % poly.length];
    b.poly([[A[0], y, A[1]], [B[0], y, B[1]], apex], col, [(A[0] + B[0]) / 2 - cx, 0.5, (A[1] + B[1]) / 2 - cz], TILE);
  }
}
export function chimney(b, x, z, y, a, col) {
  walls(b, rect(x, z, a, 0.8, 0.8), y - 1.5, y + 1.6, y, col, 99, 99, 1);
  walls(b, rect(x, z, a, 1.1, 1.1), y + 1.6, y + 1.85, y, shade(col, 0.9), 99, 99, 1);
  cap(b, rect(x, z, a, 1.1, 1.1), y + 1.85, shade(col, 0.6));
}
export const circle = (cx, cz, r, n = 12) => Array.from({ length: n }, (_, k) => [cx + r * Math.cos((k / n) * Math.PI * 2), cz + r * Math.sin((k / n) * Math.PI * 2)]);

export function dome(b, x, y, z, r, col, lat = 6, lon = 16) {
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
    const P = (ii, jj) => {
      const t = (ii / lat) * Math.PI / 2, f = (jj / lon) * Math.PI * 2;
      return [x + r * Math.cos(t) * Math.cos(f), y + r * Math.sin(t) * 1.15, z + r * Math.cos(t) * Math.sin(f)];
    };
    const a = P(i, j), bb = P(i, j + 1), c = P(i + 1, j + 1), d = P(i + 1, j);
    const mid = [(a[0] + c[0]) / 2 - x, (a[1] + c[1]) / 2 - y, (a[2] + c[2]) / 2 - z];
    b.poly(i === lat - 1 ? [a, bb, c] : [a, bb, c, d], col, mid);
  }
}

// Drum + dome + little lantern.
export function domed(bs, x, z, y, r, drumH = r * 0.6) {
  walls(bs.wall, circle(x, z, r, 16), y, y + drumH, y - STOREY * 3, bs.stone, BAY, STOREY, 1);
  dome(bs.gold, x, y + drumH, z, r * 1.02, GOLD);
  walls(bs.wall, circle(x, z, r * 0.14, 8), y + drumH + r * 1.1, y + drumH + r * 1.1 + r * 0.35, 0, bs.stone, BAY, STOREY, 1);
  pyramid(bs.gold, circle(x, z, r * 0.16, 8), y + drumH + r * 1.1 + r * 0.35, r * 0.3, GOLD);
}

export function campanile(bs, x, z, g, h, s = 7, a = 0) {
  const fp = rect(x, z, a, s, s);
  walls(bs.wall, fp, g - 2, g + h, g, bs.stone, 3.5, 5);
  cornice(bs.plain, x, z, a, s, s, g + h, 0.6, 0.4, bs.stone);
  pyramid(bs.roof, rect(x, z, a, s + 1, s + 1), g + h, s * 0.9, bs.tile);
}

// A palazzo: arcaded ground floor, stone upper storeys, cornice, low hip roof, optional domes/tower.
export function palazzo(bs, ground, x, z, a, w, d, h, opt = {}) {
  const fp = rect(x, z, a, w, d);
  const g = Math.min(...fp.map(([px, pz]) => ground(px, pz)), ground(x, z));
  walls(bs.facade.arcade, fp, g - 3, g + 4.6, g, bs.stone, 5.5, 4.6);
  walls(bs.wall, fp, g + 4.6, g + h, g, bs.stone, 5.5, 4.6, 1);
  cornice(bs.plain, x, z, a, w, d, g + h, 0.9, 0.6, bs.stone);
  hipRoof(bs.roof, x, z, a, w, d, g + h, Math.min(w, d) * 0.22, bs.tile);
  const domes = opt.domes || 0;
  for (let k = 0; k < domes; k++) {
    const u = domes === 1 ? 0 : (k / (domes - 1) - 0.5) * w * 0.55;
    domed(bs, x + u * Math.cos(a), z + u * Math.sin(a), g + h, Math.min(w, d) * 0.3);
  }
  if (opt.tower) campanile(bs, x + (w / 2 - 4) * Math.cos(a), z + (w / 2 - 4) * Math.sin(a), g, opt.tower, 7, a);
  return g;
}

// --- Perlin-displaced solids for instanced trees and rocks ------------------------------------

function icosphere(sub) {
  const t = (1 + Math.sqrt(5)) / 2;
  const v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(norm);
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < sub; s++) {
    const nf = [], cache = new Map();
    const mid = (a, b) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (!cache.has(k)) { v.push(norm([(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2])); cache.set(k, v.length - 1); }
      return cache.get(k);
    };
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { v, f };
}
const ICO = [icosphere(0), icosphere(1)];

// A lumpy blob: icosphere displaced by Perlin noise, darker underneath, noise-tinted.
export function lump(b, cx, cy, cz, rx, ry, col, { sub = 1, rough = 0.28, seed = 0, ao = 0.65 } = {}) {
  const { v, f } = ICO[sub];
  const P = v.map(([x, y, z]) => {
    const k = 1 + rough * perlin(x * 1.7 + seed, y * 1.7 + z * 1.3 + seed * 0.7);
    return [cx + x * rx * k, cy + y * ry * k, cz + z * rx * k];
  });
  const tint = (p) => {
    const up = Math.min(1, Math.max(0, (p[1] - (cy - ry)) / (2 * ry)));
    return shade(col, (ao + (1 - ao) * up) * (1 + 0.16 * perlin(p[0] * 0.9 + seed, p[2] * 0.9 + p[1] * 0.5)));
  };
  for (const [a, bb, c] of f) {
    const m = [(P[a][0] + P[bb][0] + P[c][0]) / 3 - cx, (P[a][1] + P[bb][1] + P[c][1]) / 3 - cy, (P[a][2] + P[bb][2] + P[c][2]) / 3 - cz];
    b.poly([P[a], P[bb], P[c]], tint, m);
  }
}
// Tapered trunk or limb from p0 to p1 (a 5-sided prism).
export function limb(b, p0, p1, r0, r1, col) {
  const d = norm(sub(p1, p0)), side = norm(Math.abs(d[1]) > 0.9 ? cross(d, [1, 0, 0]) : cross(d, UP)), side2 = cross(d, side);
  const ring = (p, r) => Array.from({ length: 5 }, (_, k) => {
    const a = (k / 5) * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r;
    return [p[0] + side[0] * c + side2[0] * s, p[1] + side[1] * c + side2[1] * s, p[2] + side[2] * c + side2[2] * s];
  });
  const A = ring(p0, r0), B = ring(p1, r1), mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
  for (let k = 0; k < 5; k++) {
    const k2 = (k + 1) % 5, m = sub([(A[k][0] + B[k2][0]) / 2, (A[k][1] + B[k2][1]) / 2, (A[k][2] + B[k2][2]) / 2], mid);
    b.poly([A[k], A[k2], B[k2], B[k]], (p) => shade(col, 0.7 + 0.3 * Math.min(1, Math.max(0, p[1] / 5))), m);
  }
}

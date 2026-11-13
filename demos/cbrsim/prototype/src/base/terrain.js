// The shared ground, plus whatever the current vision does to it.
//
// The base supplies the natural landform (site.js: hills, noise, the rise to the ranges).
// A vision supplies a `landform` describing what it changes:
//   water   – a water model (see waterways.js): query(x, z) -> { d, w, ... } for the nearest
//             water body, and bed(x, z, h, r) -> the carved ground height near it
//   flatten – level pads cut into the ground: [x, z, radiusX, radiusZ]
//   tint    – optional (x, z, colour, mix) -> colour, for lawns, parks, gardens
// Call initTerrain(landform) once, before anything reads the ground.
import { WATER, GRID, CALM, HILLS } from './site.js';
import { perlin, fractal } from './noise.js';

export { WATER, GRID };
const N = GRID.size / GRID.step + 1;
const X0 = -GRID.size / 2;

function hash(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
export function fbm(x, z, oct = 4) {
  let s = 0, a = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { s += a * (vnoise(x * f, z * f) * 2 - 1); f *= 2; a *= 0.5; }
  return s;
}
export const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// The natural 1911 ground, identical for every vision.
export function natural(x, z) {
  const [cx, cz] = CALM.centre;
  const calm = 0.25 + 0.75 * smoothstep(CALM.inner, CALM.outer, Math.hypot(x - cx, z - cz));
  let h = 7 + 5 * calm + calm * (fbm(x / 1800, z / 1800) * 14 + fbm(x / 350, z / 350, 3) * 3);
  for (const [hx, hz, amp, rx, rz] of HILLS) {
    const u = (x - hx) / rx, v = (z - hz) / rz;
    h += amp * Math.exp(-(u * u + v * v)) * (1 + 0.15 * fbm(x / 300, z / 300, 2));
  }
  const r = Math.hypot(x, z);
  if (r > 4500) h += (r - 4500) * 0.16 * (0.7 + 0.5 * fbm(x / 2500, z / 2500, 2));
  return h;
}

// --- The current vision's changes ---------------------------------------------------
const DRY = { query: () => ({ d: Infinity, w: 0 }), bed: (x, z, h) => h };
let land = { water: DRY, flatten: [], tint: null }, padLevel = [];

export function height(x, z) {
  let h = natural(x, z);
  land.flatten.forEach(([fx, fz, rx, rz], k) => {
    const e = Math.hypot((x - fx) / rx, (z - fz) / rz);
    const m = 1 - smoothstep(0.85, 1.35, e);
    if (m > 0) h += (padLevel[k] - h) * m;
  });
  return land.water.bed(x, z, h, land.water.query(x, z));
}
// Nearest water body (for sound, planting, building on dry land).
export const water = (x, z) => land.water.query(x, z);

// Cached grid + exact triangle interpolation, so anything placed on the ground
// sits on the rendered mesh rather than the analytic surface.
export let heights = new Float32Array(N * N);
export function initTerrain(landform = {}) {
  land = { water: landform.water || DRY, flatten: landform.flatten || [], tint: landform.tint || null };
  padLevel = land.flatten.map(([x, z]) => natural(x, z));
  heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) heights[j * N + i] = height(X0 + i * GRID.step, X0 + j * GRID.step);
}

export function ground(x, z) {
  const gx = (x - X0) / GRID.step, gz = (z - X0) / GRID.step;
  const i = Math.min(N - 2, Math.max(0, Math.floor(gx))), j = Math.min(N - 2, Math.max(0, Math.floor(gz)));
  const fx = gx - i, fz = gz - j;
  const h00 = heights[j * N + i], h10 = heights[j * N + i + 1], h01 = heights[(j + 1) * N + i], h11 = heights[(j + 1) * N + i + 1];
  if (fx + fz <= 1) return h00 + fx * (h10 - h00) + fz * (h01 - h00);
  return h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
}

// Terrain as chunked meshes, each with a full and a coarse (1/16) index buffer for
// distance LOD, and a skirt round the edge to hide cracks between LOD levels.
export const COARSE = 4;
export function terrainChunks(cells = 100) {
  const out = [];
  const H = (i, j) => heights[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  for (let cj = 0; cj < N - 1; cj += cells) for (let ci = 0; ci < N - 1; ci += cells) {
    const ni = Math.min(cells, N - 1 - ci) + 1, nj = Math.min(cells, N - 1 - cj) + 1;
    const edge = [];                                   // perimeter, in order
    for (let i = 0; i < ni - 1; i++) edge.push([i, 0]);
    for (let j = 0; j < nj - 1; j++) edge.push([ni - 1, j]);
    for (let i = ni - 1; i > 0; i--) edge.push([i, nj - 1]);
    for (let j = nj - 1; j > 0; j--) edge.push([0, j]);
    const nv = ni * nj + edge.length;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = new Uint8Array(nv * 4);
    const put = (k, gi, gj, drop) => {
      const x = X0 + gi * GRID.step, z = X0 + gj * GRID.step, y = H(gi, gj);
      pos.set([x, y - drop, z], k * 3); uv.set([x / 6, z / 6], k * 2);
      const nx = H(gi - 1, gj) - H(gi + 1, gj), nz = H(gi, gj - 1) - H(gi, gj + 1), ny = 2 * GRID.step, l = Math.hypot(nx, ny, nz);
      nrm.set([nx / l, ny / l, nz / l], k * 3);
      col.set([...groundColour(x, y, z, ny / l), 255], k * 4);
    };
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) put(j * ni + i, ci + i, cj + j, 0);
    edge.forEach(([i, j], e) => put(ni * nj + e, ci + i, cj + j, 12));
    const lod = (st) => {
      const idx = [];
      for (let j = 0; j < nj - 1; j += st) for (let i = 0; i < ni - 1; i += st) {
        const i2 = Math.min(i + st, ni - 1), j2 = Math.min(j + st, nj - 1);
        const a = j * ni + i, b = j * ni + i2, c = j2 * ni + i, d = j2 * ni + i2;   // a=00 b=10 c=01 d=11
        idx.push(a, c, b, b, c, d);
      }
      // Skirt: hang a strip below every st-th edge vertex.
      const ring = edge.map((e, k) => k).filter((k) => { const [i, j] = edge[k]; return i % st === 0 && j % st === 0; });
      ring.forEach((k, r) => {
        const k2 = ring[(r + 1) % ring.length], [i1, j1] = edge[k], [i2, j2] = edge[k2];
        const a = j1 * ni + i1, b = j2 * ni + i2, a2 = ni * nj + k, b2 = ni * nj + k2;
        idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);   // both windings; cheap and never seen edge-on
      });
      return new Uint32Array(idx);
    };
    out.push({ positions: pos, normals: nrm, uvs: uv, colors: col, indices: lod(1), coarse: lod(COARSE),
      cx: X0 + (ci + cells / 2) * GRID.step, cz: X0 + (cj + cells / 2) * GRID.step });
  }
  return out;
}

// Ground tint: dry paddock, greener hollows and damp banks, eucalypt scrub on the hills.
// Perlin patches break it all up; the vision's tint() adds its lawns and parks on top.
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.min(1, Math.max(0, t)));
export const groundColourAt = (x, z) => groundColour(x, ground(x, z), z, 1);
function groundColour(x, y, z, flat) {
  if (y < WATER + 0.5) return [150, 140, 112];
  const patch = fractal(x / 700, z / 700, 4), fine = perlin(x / 45, z / 45);
  const dry = [196, 184, 124], green = [128, 148, 84], scrub = [92, 104, 70];
  const wet = smoothstep(8, 1, y - WATER);
  const hill = smoothstep(40, 150, y) * (0.6 + 0.5 * patch) + (1 - flat) * 2.2;
  let c = mix(dry, green, 0.3 + patch * 0.9 + wet * 0.7);
  c = mix(c, scrub, hill);
  if (land.tint) c = land.tint(x, z, c, mix);
  return c.map((v) => Math.round(Math.min(255, Math.max(0, v * (1 + fine * 0.07)))));
}

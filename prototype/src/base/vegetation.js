// Instanced vegetation and rocks. Each species is one small mesh built once;
// placements are collected here and drawn with hardware instancing per tile.
import { Builder, lump, limb, shade, walls, cap, rect } from './kit.js';
import { perlin, fractal } from './noise.js';
import { ground, groundColourAt } from './terrain.js';
import { occupied } from './occupancy.js';

const BARK = [196, 188, 170], DARK_BARK = [96, 80, 64];

// name -> builder function(b, variant). Sizes are real metres at scale 1.
const SPECIES = {
  // Pale-trunked, open, grey-green crowns in clumps.
  eucalypt: (b, v) => {
    limb(b, [0, -0.5, 0], [0.3, 7, 0.1], 0.32, 0.16, BARK);
    limb(b, [0.2, 4.5, 0], [-1.8, 8.5, 0.6], 0.14, 0.07, BARK);
    limb(b, [0.25, 5.5, 0], [2, 9.5, -0.8], 0.12, 0.06, BARK);
    // Many small, loose clumps rather than a few pads: reads as sparse eucalypt canopy.
    const leaf = v ? [128, 140, 108] : [112, 130, 96];
    [[-2, 9.2, 0.7], [2.1, 10.2, -0.9], [0.3, 11.6, 0.2], [0.8, 8.2, 1.6], [-0.9, 10.8, -1.4], [1.6, 12.2, 1.1], [-2.4, 11.4, 1.8]]
      .forEach(([x, y, z], k) => lump(b, x, y, z, 1.5 + (k % 3) * 0.3, 1.1 + (k % 2) * 0.3, leaf, { sub: 0, seed: k * 3 + v, ao: 0.72 }));
  },
  // Italian cypress: dark, narrow, pointed.
  cypress: (b, v) => {
    limb(b, [0, -0.5, 0], [0, 1.5, 0], 0.25, 0.2, DARK_BARK);
    lump(b, 0, 6.5, 0, 1.3, 5.8, v ? [58, 80, 52] : [48, 70, 46], { sub: 1, rough: 0.12, seed: 3 + v, ao: 0.5 });
  },
  // Lombardy poplar: tall, narrow, lighter green, by the water.
  poplar: (b, v) => {
    limb(b, [0, -0.5, 0], [0, 3, 0], 0.3, 0.22, BARK);
    lump(b, 0, 9, 0, 1.9, 7, v ? [118, 140, 70] : [100, 128, 64], { sub: 1, rough: 0.2, seed: 5 + v });
  },
  // Plane tree: broad round crown on a clean trunk, for avenues and squares.
  plane: (b, v) => {
    limb(b, [0, -0.5, 0], [0, 4.2, 0], 0.34, 0.26, [150, 140, 118]);
    lump(b, 0, 7.4, 0, 4.2, 3.4, v ? [96, 126, 66] : [84, 114, 60], { sub: 1, rough: 0.26, seed: 11 + v });
    lump(b, 1.2, 9.5, -0.6, 2.4, 2, v ? [104, 134, 72] : [92, 122, 64], { sub: 0, seed: 13 + v });
  },
  // Street lamp: iron post and a lantern whose vertex colour glows at night.
  lamp: (b) => {
    limb(b, [0, -0.3, 0], [0, 4.2, 0], 0.09, 0.06, [46, 46, 48]);
    walls(b, rect(0, 0, 0, 0.36, 0.36), 4.2, 4.75, 4.2, [255, 222, 160], 99, 99, 1);
    cap(b, rect(0, 0, 0, 0.5, 0.5), 4.8, [40, 40, 42]);
    walls(b, rect(0, 0, 0, 0.5, 0.5), 4.75, 4.8, 4.75, [40, 40, 42], 99, 99, 1);
  },
  // Park bench: slatted seat and back on stone ends.
  bench: (b) => {
    const wood = [132, 98, 66], stone = [206, 198, 182];
    for (const x of [-0.8, 0.8]) { walls(b, rect(x, 0, 0, 0.12, 0.5), -0.1, 0.45, 0, stone, 99, 99, 1); cap(b, rect(x, 0, 0, 0.12, 0.5), 0.45, stone); }
    walls(b, rect(0, 0, 0, 1.9, 0.45), 0.45, 0.5, 0, wood, 99, 99, 1); cap(b, rect(0, 0, 0, 1.9, 0.45), 0.5, wood);
    walls(b, rect(0, 0.22, 0, 1.9, 0.05), 0.55, 0.95, 0, wood, 99, 99, 1); cap(b, rect(0, 0.22, 0, 1.9, 0.05), 0.95, wood);
  },
  // Granite boulders (Canberra's hills are strewn with them), half sunk.
  rock: (b, v) => {
    lump(b, 0, 0.2, 0, 1.4, 0.9, v ? [160, 154, 144] : [138, 134, 126], { sub: 1, rough: 0.5, seed: 21 + v * 5, ao: 0.6 });
  },
};

// Distant stand-ins: one crown lump and a stick, about a quarter of the triangles.
const FAR = {
  eucalypt: (b, v) => { limb(b, [0, -0.5, 0], [0, 8, 0], 0.3, 0.2, BARK); lump(b, 0, 10, 0, 3.4, 2.4, v ? [112, 124, 96] : [96, 114, 84], { sub: 0, seed: 2 }); },
  cypress: (b, v) => lump(b, 0, 6, 0, 1.3, 6, v ? [58, 80, 52] : [48, 70, 46], { sub: 0, rough: 0.1 }),
  poplar: (b, v) => lump(b, 0, 8.5, 0, 1.9, 7.5, v ? [118, 140, 70] : [100, 128, 64], { sub: 0, rough: 0.1 }),
  plane: (b, v) => { limb(b, [0, -0.5, 0], [0, 4.5, 0], 0.34, 0.26, [150, 140, 118]); lump(b, 0, 7.6, 0, 4.4, 3.6, v ? [96, 126, 66] : [84, 114, 60], { sub: 0 }); },
  rock: (b, v) => lump(b, 0, 0.2, 0, 1.4, 0.9, v ? [160, 154, 144] : [138, 134, 126], { sub: 0, rough: 0.4, seed: 21 }),
  lamp: (b) => SPECIES.lamp(b),
  bench: (b) => SPECIES.bench(b),
};
export function speciesBuilders(far = false) {
  const out = {};
  for (const [name, fn] of Object.entries(far ? FAR : SPECIES)) for (const v of [0, 1]) {
    const b = new Builder(); fn(b, v); out[`${name}${v}`] = b;
  }
  return out;
}

// key -> [x, y, z, scale, rotation, ...]
export const instances = {};
let seed = 77;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

// Street furniture: explicit rotation, allowed on paving, never inside buildings.
export function prop(species, x, z, rot = 0) {
  if (occupied(x, z) & 1 || ground(x, z) < 0.6) return;
  (instances[`${species}0`] ||= []).push(x, ground(x, z) + (species === 'lamp' ? 0.4 : 0.35), z, 1, rot);
}

export function plant(species, x, z, s = 1, { onPaving = false } = {}) {
  const g = ground(x, z);
  if (g < 0.6) return false;
  const occ = occupied(x, z);
  if (occ & 1 || (!onPaving && occ & 2)) return false;
  const variant = perlin(x / 90, z / 90) > 0 ? 1 : 0;
  (instances[`${species}${variant}`] ||= []).push(x, g, z, s * (0.85 + rand() * 0.3), rand() * Math.PI * 2);
  return true;
}

// Scatter by noise: clumps where fractal noise is high, glades where low.
export function scatter(species, cx, cz, rx, rz, count, { minS = 0.8, maxS = 1.3, clump = 0.05, freq = 250, where = () => true } = {}) {
  let n = 0;
  for (let k = 0; k < count * 4 && n < count; k++) {
    const x = cx + (rand() * 2 - 1) * rx, z = cz + (rand() * 2 - 1) * rz;
    if (fractal(x / freq, z / freq, 3) < clump || !where(x, z)) continue;
    if (plant(species, x, z, minS + rand() * (maxS - minS))) n++;
  }
}

// Grass tufts: a few crossed alpha-tested quads, re-scattered round the viewer.
// Three tints (straw, olive, lawn green); each tuft takes the one nearest the ground under it.
export const TUFT_TINTS = [[196, 182, 112], [168, 172, 100], [132, 170, 88]];
export function tuftBuilder(tint) {
  const b = new Builder();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI, c = Math.cos(a) * 0.55, s = Math.sin(a) * 0.55;
    const col = (p) => shade(tint, 0.85 + 0.25 * p[1] / 0.7);
    b.poly([[-c, 0, -s], [c, 0, s], [c, 0.7, s], [-c, 0.7, -s]], col, null, [[0, 1], [1, 1], [1, 0], [0, 0]]);
  }
  return b;
}
export function tuftField(px, pz, radius = 70, count = 7000) {
  const outs = TUFT_TINTS.map(() => new Float32Array(count * 16)), counts = [0, 0, 0];
  let n = 0;
  const step = (radius * 2) / Math.sqrt(count);
  for (let gz = pz - radius; gz < pz + radius; gz += step) for (let gx = px - radius; gx < px + radius; gx += step) {
    // Snap to a world grid + hash jitter so tufts don't swim as you move.
    const ix = Math.round(gx / step), iz = Math.round(gz / step);
    const h1 = perlin(ix * 0.731 + 0.1, iz * 0.593 + 0.3), h2 = perlin(ix * 0.417 + 0.7, iz * 0.911 + 0.2);
    const x = ix * step + h1 * step, z = iz * step + h2 * step;
    if ((x - px) ** 2 + (z - pz) ** 2 > radius * radius || n >= count) continue;
    if (fractal(x / 25, z / 25, 2) < -0.15 || occupied(x, z)) continue;
    const y = ground(x, z);
    if (y < 0.8) continue;
    const s = 0.45 + (h1 + 1) * 0.3, r = h2 * 6;
    const [cr, cg] = groundColourAt(x, z), green = cg - cr, v = green < 0 ? 0 : green < 16 ? 1 : 2;
    outs[v].set([s * Math.cos(r), 0, -s * Math.sin(r), 0, 0, s, 0, 0, s * Math.sin(r), 0, s * Math.cos(r), 0, x, y - 0.05, z, 1], counts[v] * 16);
    counts[v]++; n++;
  }
  return outs.map((data, v) => ({ data, count: counts[v] }));
}

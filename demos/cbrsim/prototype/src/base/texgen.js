// Procedural textures, all generated at startup from Perlin noise: no image files.
// Textures are mostly neutral in hue; vertex colours supply the actual colour.
// Each generator returns { color: canvas, normal?: canvas }. In pixel space y = 0 is the top row.
import { fractal, perlin } from './noise.js';

function canvasFrom(size, px) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size);
  img.data.set(px); g.putImageData(img, 0, 0);
  return c;
}

// Run fn(x, y) -> [r, g, b, a, height] over the tile; builds colour + normal-map canvases.
function gen(size, fn, bump = 0) {
  const col = new Uint8ClampedArray(size * size * 4), h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const [r, g, b, a = 255, hh = 0] = fn(x, y), k = y * size + x;
    col.set([r, g, b, a], k * 4); h[k] = hh;
  }
  const out = { color: canvasFrom(size, col) };
  if (bump) {
    const nrm = new Uint8ClampedArray(size * size * 4), H = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * bump, dy = (H(x, y + 1) - H(x, y - 1)) * bump, l = Math.hypot(dx, dy, 1);
      nrm.set([(dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255, 255], (y * size + x) * 4);
    }
    out.normal = canvasFrom(size, nrm);
  }
  return out;
}
const n01 = (x, y, f, oct, size) => fractal((x / size) * f, (y / size) * f, oct, f) * 0.5 + 0.5;
const grey = (v, warm = 0) => [v * 255 * (1 + warm), v * 255, v * 255 * (1 - warm)];

export function grass(size = 512) {
  return gen(size, (x, y) => {
    const macro = n01(x, y, 4, 4, size), blade = (perlin((x / size) * 64, (y / size) * 48, 64) + perlin((x / size) * 128, (y / size) * 128, 128)) * 0.25 + 0.5;
    const hue = n01(x + 97, y + 31, 6, 3, size);
    const l = 0.72 + macro * 0.2 + (blade - 0.5) * 0.16;
    return [l * 255 * (0.96 + hue * 0.1), l * 255, l * 255 * (0.98 - hue * 0.12)];
  });
}
export function detail(size = 256) {
  return gen(size, (x, y) => grey(0.5 + fractal((x / size) * 8, (y / size) * 8, 3, 8) * 0.35));
}
export function gravel(size = 256) {
  return gen(size, (x, y) => {
    const n = n01(x, y, 4, 3, size), peb = perlin((x / size) * 96, (y / size) * 96, 96);
    const l = 0.8 + n * 0.1 + peb * 0.05 + (peb > 0.55 ? 0.05 : 0);
    return [...grey(l, 0.03), 255, peb * 0.4];
  }, 1.5);
}
// Irregular flagstones: 4 rows, staggered, each stone tinted.
export function paving(size = 256) {
  return gen(size, (x, y) => {
    const row = Math.floor((y / size) * 4), off = (row % 2) * 0.5 + row * 0.13;
    const u = (x / size) * 3 + off, col = Math.floor(u) % 3;
    const fu = u - Math.floor(u), fv = (y / size) * 4 - row;
    const joint = Math.min(fu, 1 - fu, fv * 0.75, (1 - fv) * 0.75) < 0.03;
    const tint = perlin(row * 3.1 + col * 7.7, 0.5) * 0.1;
    const l = joint ? 0.55 : 0.84 + tint + fractal((x / size) * 16, (y / size) * 16, 2, 16) * 0.05;
    return [...grey(l, 0.02), 255, joint ? 0 : 1];
  }, 2.5);
}
// Barrel-tile rows: shading across each tile, a shadow under each course.
export function roofTiles(size = 256) {
  return gen(size, (x, y) => {
    const rows = 8, cols = 8, fv = ((y / size) * rows) % 1, c = Math.floor((x / size) * cols), r = Math.floor((y / size) * rows);
    const fu = ((x / size) * cols) % 1;
    const barrel = Math.sin(fu * Math.PI);
    const shade = 0.62 + barrel * 0.38 - (fv > 0.85 ? 0.3 : 0);
    const tint = perlin(c * 1.7 + 0.3, r * 2.3 + 0.7) * 0.12 + fractal((x / size) * 12, (y / size) * 12, 2, 12) * 0.06;
    return [...grey(shade + tint, 0.05), 255, barrel - (fv > 0.85 ? 0.6 : 0)];
  }, 2);
}

// --- Facades: one bay (4 m) by one storey (3.4 m) --------------------------------------
function ashlar(x, y, size) {
  const course = Math.floor((y / size) * 6), fv = ((y / size) * 6) % 1;
  const fu = ((x / size) * 2 + (course % 2) * 0.5) % 1;
  const joint = fv < 0.05 || fu < 0.025;
  return { l: 0.9 + fractal((x / size) * 6, (y / size) * 6, 3, 6) * 0.08 - (joint ? 0.06 : 0), h: joint ? 0.7 : 1 };
}
// String course at the foot of each storey.
const band = (y, size) => (y > size * 0.94 ? 0.06 : y > size * 0.9 ? -0.08 : 0);
function facade(size, win) {
  const out = gen(size, (x, y) => {
    const s = ashlar(x, y, size), w = win(x / size, y / size);
    const b = band(y, size);
    if (w) return [...w.rgb.map((v) => v * 255), 255, w.h];
    return [...grey(s.l + b, 0.02), 255, s.h + (b > 0 ? 0.4 : 0)];
  }, 4);
  // Night glow mask: lit glass is warm, with a little noise so panes differ.
  out.glow = gen(size, (x, y) => {
    const w = win(x / size, y / size);
    if (!w?.lit) return [0, 0, 0];
    // Glass reads as a lit room: brighter low down, curtains darker at the sides.
    const k = (0.55 + 0.25 * (y / size) + 0.1 * perlin((x / size) * 32, (y / size) * 32, 32)) * (w.h < 0 ? 0.6 : 1);
    return [255 * k, 190 * k, 110 * k];
  }).color;
  return out;
}
const inArch = (u, v, x0, x1, top, bot) => {
  const r = (x1 - x0) / 2, cx = (x0 + x1) / 2;
  return u > x0 && u < x1 && v < bot && (v > top + r || Math.hypot((u - cx) * 1, v - (top + r)) < r);
};
const GLASS = { rgb: [0.24, 0.24, 0.27], h: 0, lit: true };
export const facades = {
  arched: (size = 256) => facade(size, (u, v) => {
    if (inArch(u, v, 0.39, 0.61, 0.24, 0.74)) return GLASS;
    if (v > 0.74 && v < 0.78 && u > 0.36 && u < 0.64) return { rgb: [0.97, 0.95, 0.9], h: 1.5 };
    return null;
  }),
  shuttered: (size = 256) => facade(size, (u, v) => {
    if (v > 0.28 && v < 0.74) {
      if (u > 0.4 && u < 0.6) return GLASS;
      if ((u > 0.28 && u < 0.39) || (u > 0.61 && u < 0.72)) {
        const slat = Math.floor(v * 60) % 2 ? 0.9 : 1;
        return { rgb: [0.42 * slat, 0.55 * slat, 0.4 * slat], h: 1.2 };
      }
    }
    if (v > 0.22 && v < 0.28 && u > 0.36 && u < 0.64) return { rgb: [0.97, 0.95, 0.9], h: 1.5 };
    return null;
  }),
  balcony: (size = 256) => facade(size, (u, v) => {
    if (v > 0.62 && v < 0.84 && u > 0.3 && u < 0.7) {
      if (v < 0.645 || v > 0.815 || Math.floor(u * 60) % 3 === 0) return { rgb: [0.15, 0.15, 0.16], h: 1.6 };
    }
    if (v > 0.84 && v < 0.88 && u > 0.28 && u < 0.72) return { rgb: [0.9, 0.88, 0.84], h: 1.8 };
    if (u > 0.4 && u < 0.6 && v > 0.2 && v < 0.84) return GLASS;
    return null;
  }),
  // Ground floor: an arcade (portico) with a lit shop window deep inside.
  arcade: (size = 256) => facade(size, (u, v) => {
    if (inArch(u, v, 0.14, 0.86, 0.12, 1.01)) {
      if (u > 0.3 && u < 0.7 && v > 0.45) return { rgb: v > 0.55 ? [0.36, 0.3, 0.24] : [0.22, 0.2, 0.2], h: -0.4, lit: true };
      return { rgb: [0.3, 0.29, 0.3], h: -0.3 };
    }
    return null;
  }),
};

// Embankment / bridge / stadium: arches under a parapet.
export function arches(size = 256) {
  return gen(size, (x, y) => {
    const s = ashlar(x, y, size), u = x / size, v = y / size;
    if (inArch(u, v, 0.19, 0.81, 0.3, 0.97)) return [70, 72, 76, 255, -0.5];
    if (v < 0.12) return [...grey(s.l + 0.04, 0.02), 255, 1.2];
    return [...grey(s.l, 0.02), 255, s.h];
  }, 4);
}

// Grass-blade cluster with alpha, for instanced tufts.
export function blades(size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  let s = 7;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let k = 0; k < 26; k++) {
    const x0 = size * (0.15 + r() * 0.7), lean = (r() - 0.5) * size * 0.5, h = size * (0.45 + r() * 0.55), w = 2 + r() * 3;
    const l = 190 + r() * 60;
    g.fillStyle = `rgb(${l * 0.95},${l},${l * 0.7})`;
    g.beginPath(); g.moveTo(x0 - w, size); g.quadraticCurveTo(x0 + lean * 0.3, size - h * 0.6, x0 + lean, size - h); g.lineTo(x0 + w, size); g.fill();
  }
  return { color: c };
}

// Sky dome, painted: zenith-to-horizon wash with soft Perlin cloud banks. u wraps round
// the horizon; v runs from zenith (top row) to nadir (bottom row).
export const SKY_HORIZON = [0.80, 0.84, 0.90];
export function sky(w = 1024, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h);
  const zen = [0.47, 0.62, 0.83], hor = SKY_HORIZON;
  for (let y = 0; y < h; y++) {
    const el = 90 - (y / h) * 180, t = Math.pow(Math.max(0, el) / 90, 0.55);
    for (let x = 0; x < w; x++) {
      let col = hor.map((v, i) => v + (zen[i] - v) * t);
      if (el > 1 && el < 60) {
        const u = (x / w) * 12, band = Math.min(1, (el - 1) / 6) * (1 - Math.max(0, (el - 35) / 25));
        const n = fractal(u, el / 7, 5, 12) + 0.35 * fractal(u * 3 + 5, el / 2.5, 3, 36);
        const cloud = Math.max(0, Math.min(1, (n - 0.08) / 0.35)) * band;
        const lit = [0.97, 0.96, 0.94], under = [0.74, 0.77, 0.84];
        const cc = lit.map((v, i) => v + (under[i] - v) * Math.max(0, -n * 0.8 + 0.3));
        col = col.map((v, i) => v + (cc[i] - v) * cloud * 0.85);
      }
      if (el < 0) col = col.map((v) => v * (0.92 + 0.08 * Math.max(0, 1 + el / 20)));
      img.data.set([...col.map((v) => v * 255), 255], (y * w + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  return { color: c };
}

// Paper grain for the watercolour view (used as a CSS overlay, not a GPU texture).
export function paper(size = 512) {
  return gen(size, (x, y) => {
    const n = fractal((x / size) * 24, (y / size) * 24, 4, 24) * 0.6 + perlin((x / size) * 90, (y / size) * 90, 90) * 0.4;
    const v = 0.93 + n * 0.07;
    return [v * 255, v * 250, v * 238];
  }).color;
}

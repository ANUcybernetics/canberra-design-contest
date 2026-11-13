// 2D Perlin noise. Pass `period` to make it tile (for generated textures).
const perm = new Uint8Array(512);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = 1912;
  for (let i = 255; i > 0; i--) { s = (s * 16807) % 2147483647; const j = s % (i + 1); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i, period) => (period ? ((i % period) + period) % period : i) & 255;

export function perlin(x, y, period = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const g = (i, j, dx, dy) => { const v = G[perm[perm[wrap(i, period)] + wrap(j, period)] & 7]; return v[0] * dx + v[1] * dy; };
  const u = fade(xf), v = fade(yf);
  const a = g(xi, yi, xf, yf), b = g(xi + 1, yi, xf - 1, yf), c = g(xi, yi + 1, xf, yf - 1), d = g(xi + 1, yi + 1, xf - 1, yf - 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 1.4;   // ~[-1, 1]
}

export function fractal(x, y, oct = 4, period = 0) {
  let s = 0, amp = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { s += amp * perlin(x * f, y * f, period ? period * f : 0); f *= 2; amp *= 0.5; }
  return s;
}

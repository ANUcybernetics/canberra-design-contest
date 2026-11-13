// Water models a vision can hand to initTerrain(). Each has
//   query(x, z) -> { d: distance to the centreline, w: local half-width, ... }
//   bed(x, z, h, q) -> the ground height after carving the water into natural height h
// so the terrain never needs to know what shape a vision's water is.
import { fbm, smoothstep } from './terrain.js';

const BED = -5;

// A river as a centreline polyline. Each point is { x, z, w, far }: half-width on the
// `ref` bank, plus extra width on the other bank. Stretches at least `lakeMinWidth` wide
// count as lake; on the `ref` bank they are embanked (a steep 6 m edge), elsewhere they
// slope gently into the water.
export function riverChannel({ points, ref, lakeMinWidth = Infinity }) {
  const sideOf = (a, b, x, z) => Math.sign((b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x));
  function raw(x, z) {
    let best = { d: Infinity };
    for (let k = 0; k < points.length - 1; k++) {
      const a = points[k], b = points[k + 1];
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
      const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      const px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < best.d) best = { d, w: a.w + (b.w - a.w) * t, far: a.far + (b.far - a.far) * t, side: sideOf(a, b, x, z), px, pz };
    }
    return best;
  }
  const refSide = raw(ref[0], ref[1]).side;
  // r.cityBank: the point is on the same bank as `ref`.
  function query(x, z) {
    const r = raw(x, z);
    r.cityBank = r.side === refSide;
    if (!r.cityBank) r.w += r.far;
    return r;
  }
  function bed(x, z, h, r) {
    const embanked = r.cityBank && r.w >= lakeMinWidth;
    if (r.d < r.w) return BED + fbm(x / 200, z / 200, 2) * 0.8;
    const ramp = embanked ? 6 : r.w >= lakeMinWidth ? 260 : 120;
    return BED + (h - BED) * smoothstep(0, ramp, r.d - r.w);
  }
  return { points, lakeMinWidth, query, bed };
}

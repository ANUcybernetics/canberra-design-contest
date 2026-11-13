// Coarse "is something built here?" grid, so trees, tufts and rocks keep off
// streets, paving and buildings. 4 m cells over the central 8 km.
const CELL = 4, EXT = 4000, N = (EXT * 2) / CELL;
const grid = new Uint8Array(N * N);
export const BUILT = 1, PAVED = 2, FLAGS = 4;   // STONE: flagged paving (for footstep sounds)

const idx = (x, z) => {
  const i = Math.floor((x + EXT) / CELL), j = Math.floor((z + EXT) / CELL);
  return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
};
export function occupied(x, z) { const k = idx(x, z); return k < 0 ? 0 : grid[k]; }

// Convex polygon [[x,z]...]
export function markPoly(poly, v = BUILT) {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const inside = (x, z) => {
    let sign = 0;
    for (let k = 0; k < poly.length; k++) {
      const [ax, az] = poly[k], [bx, bz] = poly[(k + 1) % poly.length];
      const c = Math.sign((bx - ax) * (z - az) - (bz - az) * (x - ax));
      if (c && sign && c !== sign) return false;
      if (c) sign = c;
    }
    return true;
  };
  for (let z = Math.min(...zs); z <= Math.max(...zs); z += CELL) for (let x = Math.min(...xs); x <= Math.max(...xs); x += CELL) {
    const k = idx(x, z);
    if (k >= 0 && inside(x, z)) grid[k] |= v;
  }
}
export function markSegment([ax, az], [bx, bz], width, v = PAVED) {
  const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L * width / 2, nz = (bx - ax) / L * width / 2;
  markPoly([[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]], v);
}
export function markCircle(x, z, r, v = BUILT) {
  for (let dz = -r; dz <= r; dz += CELL) for (let dx = -r; dx <= r; dx += CELL) {
    const k = idx(x + dx, z + dz);
    if (k >= 0 && dx * dx + dz * dz <= r * r) grid[k] |= v;
  }
}

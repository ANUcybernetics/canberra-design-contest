// Builds Gimson's city into mesh batches. Low detail on purpose: every
// building, landmark or not, is drawn from the same Mediterranean kit.
// Small-scale variety (district colours, facade types, tree clumps) comes from Perlin noise.
import {
  PARK, RINGS, SE_GRID, LANDMARKS, BRIDGE, STADIUM, RAIL, PARLIAMENT, STATE_HALL, CATHEDRAL,
  AXIS_ANGLE, RIVER, LAKE_MIN_WIDTH,
} from './layout.js';
import { ground } from '../../base/terrain.js';
import { river } from './landform.js';
import { perlin, fractal } from '../../base/noise.js';
import {
  Batches, rng, jitter, shade, rect, walls, cap, cornice, hipRoof, gableRoof, circle, domed, campanile, palazzo, chimney,
  STONE, TERRACOTTA, STOREY,
} from '../../base/kit.js';
import { markPoly, markSegment, markCircle, occupied, PAVED, FLAGS } from '../../base/occupancy.js';
import { plant, scatter, prop } from '../../base/vegetation.js';
import { naturalBush } from '../../base/bush.js';

const R = rng(1911);
const B = new Batches(1000);
const STREET = [214, 200, 170], PAVING = [226, 216, 196], KERB = [196, 188, 172], GRASS = [118, 140, 76], FOUNTAIN = [92, 128, 140];
// Three district palettes, blended by low-frequency noise so neighbouring streets agree.
const DISTRICTS = [[[244, 238, 226], [236, 226, 204]], [[240, 216, 170], [228, 196, 150]], [[234, 204, 180], [222, 186, 160]]];
const FACADES = ['arched', 'shuttered', 'balcony'];

function bundle(x, z) {
  const f = (k) => B.get(k, x, z);
  return {
    wall: f('arched'), facade: { arched: f('arched'), shuttered: f('shuttered'), balcony: f('balcony'), arcade: f('arcade') },
    roof: f('roof'), gold: f('gold'), plain: f('plain'), arches: f('arches'), road: f('road'), paving: f('paving'),
    stone: jitter(STONE, 0.04, R), tile: jitter(TERRACOTTA, 0.12, R),
  };
}

const distSeg = (x, z, [ax, az], [bx, bz]) => {
  const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};
export const inPark = (x, z) => distSeg(x, z, PARK.a, PARK.b) < PARK.r;
const onLand = (x, z, margin = 30) => { const r = river(x, z); return r.cityBank && r.d - r.w > margin; };
const nearLandmark = (x, z, pad = 0) => LANDMARKS.some((l) => Math.hypot(x - l.at[0], z - l.at[1]) < l.clear + pad);

// Ground-hugging strip along a polyline, sampled so it follows the terrain.
function ribbon(pts, width, col, { lift = 0.25, kind = 'road', uv = { xz: 6 }, offset = 0, kerb = 0, mark = kind === 'paving' ? PAVED | FLAGS : PAVED } = {}) {
  for (let k = 0; k < pts.length - 1; k++) {
    const [ax, az] = pts[k], [bx, bz] = pts[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.5) continue;
    const n = Math.max(1, Math.ceil(len / 8)), dx = (bx - ax) / len, dz = (bz - az) / len;
    const nx = -dz, nz = dx, o0 = offset - width / 2, o1 = offset + width / 2;
    const b = B.get(kind, ax, az);
    for (let s = 0; s < n; s++) {
      const P = (t, o) => { const x = ax + (bx - ax) * t + nx * o, z = az + (bz - az) * t + nz * o; return [x, ground(x, z) + lift, z]; };
      const t0 = s / n, t1 = (s + 1) / n;
      b.poly([P(t0, o0), P(t1, o0), P(t1, o1), P(t0, o1)], col, [0, 1, 0], uv);
      if (kerb) for (const o of [o0, o1]) {   // kerb faces down to the carriageway
        const a0 = P(t0, o), a1 = P(t1, o);
        B.get('plain', ax, az).poly([a0, a1, [a1[0], a1[1] - kerb, a1[2]], [a0[0], a0[1] - kerb, a0[2]]], KERB, [nx * (o - offset), 0, nz * (o - offset)]);
      }
    }
    if (mark) markSegment([ax + nx * offset, az + nz * offset], [bx + nx * offset, bz + nz * offset], width, mark);
  }
}

// A street: gravel carriageway plus raised paved footpaths (trimmed back at the junctions)
// and lamps along the kerb. Neighbouring blocks share edges, so each street is built once.
const builtStreets = new Set();
function street(a, b, width = 11) {
  const key = [a, b].map(([x, z]) => `${Math.round(x)},${Math.round(z)}`).sort().join('|');
  if (builtStreets.has(key)) return;
  builtStreets.add(key);
  ribbon([a, b], width - 4.4, STREET, { lift: 0.22, uv: { xz: 3 } });
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), trim = width / 2 + 1;
  if (L < trim * 2 + 4) return;
  const t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const a2 = [a[0] + t[0] * trim, a[1] + t[1] * trim], b2 = [b[0] - t[0] * trim, b[1] - t[1] * trim];
  for (const side of [-1, 1]) ribbon([a2, b2], 6.4, PAVING, { lift: 0.4, kind: 'paving', uv: { plane: 2.4 }, offset: side * (width / 2 - 2.2 + 3.2), kerb: 0.18 });
  lampsAlong(a2, b2, width / 2 - 1.6, 34);
}
function lampsAlong(a, b, offset, spacing) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  for (let s = spacing / 2, k = 0; s < L; s += spacing, k++) {
    const o = (k % 2 ? 1 : -1) * offset;   // staggered either side
    prop('lamp', a[0] + t[0] * s - t[1] * o, a[1] + t[1] * s + t[0] * o);
  }
}
// Benches facing a point (a fountain, a path).
function benchFacing(x, z, tx, tz) { prop('bench', x, z, Math.atan2(-(tx - x), -(tz - z))); }
// Free-standing garden wall with a gate gap in the front side.
function gardenWall(cx, cz, a, w, d, h = 1.4) {
  const c = rect(cx, cz, a, w, d), b = B.get('plain', cx, cz), g = (x, z) => ground(x, z);
  const seg = ([ax, az], [bx, bz]) => {
    const L = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / L * 0.25, nz = (bx - ax) / L * 0.25;
    const y0 = Math.min(g(ax, az), g(bx, bz)) - 0.5, y1 = Math.max(g(ax, az), g(bx, bz)) + h;
    const col = (p) => shade(STONE, p[1] < y1 - 0.2 ? 0.9 : 1);
    for (const s of [1, -1]) b.poly([[ax + nx * s, y0, az + nz * s], [bx + nx * s, y0, bz + nz * s], [bx + nx * s, y1, bz + nz * s], [ax + nx * s, y1, az + nz * s]], col, [nx * s, 0, nz * s]);
    b.poly([[ax + nx, y1, az + nz], [bx + nx, y1, bz + nz], [bx - nx, y1, bz - nz], [ax - nx, y1, az - nz]], STONE, [0, 1, 0]);
    markSegment([ax, az], [bx, bz], 0.8, 1);
  };
  const m = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], gap = 3 / w;
  seg(c[0], m(c[0], c[1], 0.5 - gap)); seg(m(c[0], c[1], 0.5 + gap), c[1]);
  seg(c[1], c[2]); seg(c[2], c[3]); seg(c[3], c[0]);
}

function house(cx, cz, a, f, d, storeys, district, facade, arcaded) {
  const bs = bundle(cx, cz), fp = rect(cx, cz, a, f, d);
  const g = Math.min(...fp.map(([x, z]) => ground(x, z)));
  const top = g + storeys * STOREY;
  const pal = DISTRICTS[district], col = jitter(pal[R() < 0.5 ? 0 : 1], 0.05, R);
  walls(arcaded ? bs.facade.arcade : bs.facade[facade], fp, g - 2, g + STOREY, g, col);
  walls(bs.facade[facade], fp, g + STOREY, top, g, col, undefined, undefined, 1);
  cornice(bs.plain, cx, cz, a, f, d, top, 0.45, 0.3, shade(col, 1.02));
  const tile = jitter(TERRACOTTA, 0.14, R);
  if (R() < 0.55) hipRoof(bs.roof, cx, cz, a, f, d, top, d * 0.22, tile);
  else gableRoof(bs.roof, bs.plain, cx, cz, a, f, d, top, d * 0.28, tile, col);
  if (R() < 0.6) {
    const u = (R() - 0.5) * f * 0.6, v = (R() - 0.5) * d * 0.3;
    chimney(bs.plain, cx + u * Math.cos(a) - v * Math.sin(a), cz + u * Math.sin(a) + v * Math.cos(a), top + d * 0.12, a, shade(col, 0.95));
  }
  markPoly(fp);
}

// A city block: houses round the inset perimeter, garden trees inside.
function block(corners, centreDist) {
  const cx = corners.reduce((s, p) => s + p[0], 0) / corners.length, cz = corners.reduce((s, p) => s + p[1], 0) / corners.length;
  const inset = corners.map(([x, z]) => { const dx = cx - x, dz = cz - z, l = Math.hypot(dx, dz); return [x + dx / l * 9, z + dz / l * 9]; });
  const tall = centreDist < 700 ? 1 : 0;
  // District, facade type and arcading vary smoothly across the city.
  const dn = perlin(cx / 700 + 3.3, cz / 700 + 1.1), district = dn < -0.15 ? 0 : dn < 0.2 ? 1 : 2;
  const fn = perlin(cx / 260 + 7.7, cz / 260 + 2.9), facade = FACADES[fn < -0.2 ? 0 : fn < 0.2 ? 1 : 2];
  const arcaded = centreDist < 800 && perlin(cx / 400, cz / 400 + 5) > -0.1;
  for (let k = 0; k < inset.length; k++) {
    const A = inset[k], Bp = inset[(k + 1) % inset.length];
    const L = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
    if (L < 25) continue;
    const t = [(Bp[0] - A[0]) / L, (Bp[1] - A[1]) / L];
    let n = [-t[1], t[0]];
    if ((cx - A[0]) * n[0] + (cz - A[1]) * n[1] < 0) n = [-n[0], -n[1]];
    const a = Math.atan2(t[1], t[0]);
    for (let s = 0; s < L - 6;) {
      let f = 9 + R() * 7; if (s + f > L) f = L - s; if (f < 6) break;
      const d = 10 + R() * 4, m = s + f / 2, x = A[0] + t[0] * m + n[0] * d / 2, z = A[1] + t[1] * m + n[1] * d / 2;
      const storeys = 2 + tall + (fractal(x / 80, z / 80, 2) > 0.1 ? 1 : 0) + (s === 0 ? 1 : 0);
      house(x, z, a, f - 0.3, d, storeys, district, facade, arcaded);
      s += f;
    }
  }
  if (R() < 0.1) { const [x, z] = inset[0]; campanile(bundle(x, z), x + 6, z + 6, ground(x, z), 26 + R() * 12); markCircle(x + 6, z + 6, 6); }
  for (let k = 0; k < 3; k++) plant(R() < 0.3 ? 'cypress' : 'plane', cx + (R() - 0.5) * 34, cz + (R() - 0.5) * 34, 0.7 + R() * 0.3);
}

const cellOk = (corners) => corners.every(([x, z]) => onLand(x, z) && !inPark(x, z) && !nearLandmark(x, z));
const streetsOf = (corners) => corners.forEach((p, k) => street(p, corners[(k + 1) % corners.length]));

const boulevards = [];
function buildRings() {
  const [cx, cz] = RINGS.centre;
  for (let k = 0; k < RINGS.count; k++) {
    const r0 = RINGS.r0 + k * RINGS.step, r1 = r0 + RINGS.step;
    if (r0 > RINGS.maxR) break;
    const n = Math.max(8, Math.round((2 * Math.PI * (r0 + r1) / 2) / RINGS.sector));
    const phase = R() * Math.PI * 2;
    for (let s = 0; s < n; s++) {
      const a0 = phase + (s / n) * Math.PI * 2, a1 = phase + ((s + 1) / n) * Math.PI * 2;
      const P = (r, a) => [cx + r * Math.cos(a), cz + r * Math.sin(a)];
      const corners = [P(r0, a0), P(r0, a1), P(r1, a1), P(r1, a0)];
      if (!cellOk(corners)) continue;
      streetsOf(corners);
      block(corners, r0);
      if (k === 3) boulevards.push([corners[0], corners[1]]);
    }
  }
}

function buildGrid() {
  const { origin: [ox, oz], dir: [ux, uz], cellU, cellV, nu, nv } = SE_GRID;
  const vx = -uz, vz = ux;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const P = (a, b) => [ox + ux * a * cellU + vx * b * cellV, oz + uz * a * cellU + vz * b * cellV];
    const corners = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
    if (!cellOk(corners)) continue;
    streetsOf(corners);
    block(corners, 9999);
  }
}

// --- Landmarks ---------------------------------------------------------------

function fountain(x, z) {
  const bs = bundle(x, z), g = ground(x, z) + 0.4;
  walls(bs.plain, circle(x, z, 6, 16), g - 0.5, g + 0.7, g, shade(STONE, 0.95), 99, 99, 1);
  cap(bs.plain, circle(x, z, 6.4, 16).map(([px, pz]) => [px, pz]), g + 0.7, STONE);
  cap(bs.plain, circle(x, z, 5.7, 16), g + 0.72, FOUNTAIN);
  walls(bs.plain, circle(x, z, 0.6, 8), g + 0.7, g + 2.6, g, STONE, 99, 99, 1);
  walls(bs.plain, circle(x, z, 2, 12), g + 2.6, g + 3.0, g, STONE, 99, 99, 1);
  cap(bs.plain, circle(x, z, 1.8, 12), g + 3.02, FOUNTAIN);
  markCircle(x, z, 7);
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; benchFacing(x + Math.cos(a) * 11, z + Math.sin(a) * 11, x, z); }
}
function piazza(x, z, a, w, d, withFountain = true) {
  const g = ground(x, z) + 0.35, poly = rect(x, z, a, w, d);
  cap(B.get('paving', x, z), poly, g, PAVING, { plane: 2.4 });
  markPoly(poly, PAVED | FLAGS);
  for (const [px, pz] of rect(x, z, a, w - 6, d - 6)) prop('lamp', px, pz);
  if (withFountain) fountain(x, z);
}

function parliament([x, z]) {
  const bs = bundle(x, z), g = ground(x, z);
  for (const a of [Math.PI / 4, -Math.PI / 4]) {
    walls(bs.facade.arcade, rect(x, z, a, 170, 28), g - 3, g + 5, g, bs.stone, 5.5, 5);
    walls(bs.wall, rect(x, z, a, 170, 28), g + 5, g + 20, g, bs.stone, 5.5, 5, 1);
    cornice(bs.plain, x, z, a, 170, 28, g + 20, 1, 0.7, bs.stone);
    hipRoof(bs.roof, x, z, a, 170, 28, g + 20, 6, bs.tile);
    for (const e of [-1, 1]) domed(bs, x + Math.cos(a) * 78 * e, z + Math.sin(a) * 78 * e, g + 20, 9);
    markPoly(rect(x, z, a, 176, 34));
  }
  walls(bs.wall, circle(x, z, 26, 16), g - 3, g + 26, g, bs.stone, 5.5, 5);
  domed(bs, x, z, g + 26, 22, 10);
  campanile(bs, x + 30, z - 60, g, 62, 9);
  cap(bs.paving, circle(x, z, 150, 32), g + 0.15, PAVING, { plane: 2.4 });
  markCircle(x, z, 150, PAVED | FLAGS);
  fountain(x, z + 120);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8, px = x + Math.cos(a) * 235, pz = z + Math.sin(a) * 235;
    palazzo(bundle(px, pz), ground, px, pz, a + Math.PI / 2, 56, 24, 14, { domes: 1 });
    markPoly(rect(px, pz, a + Math.PI / 2, 62, 30));
  }
}

function stateHall([x, z], a) {
  const bs = bundle(x, z);
  const g = palazzo(bs, ground, x, z, a, 80, 52, 18);
  domed(bs, x, z, g + 18, 17, 10);
  for (const [u, v] of [[-34, -20], [34, -20], [34, 20], [-34, 20]])
    domed(bs, x + u * Math.cos(a) - v * Math.sin(a), z + u * Math.sin(a) + v * Math.cos(a), g + 18, 6);
  markPoly(rect(x, z, a, 90, 62));
}

function cathedral([x, z], a) {
  const bs = bundle(x, z), g = ground(x, z);
  const T = (u, v) => [x + u * Math.cos(a) - v * Math.sin(a), z + u * Math.sin(a) + v * Math.cos(a)];
  walls(bs.wall, rect(x, z, a, 110, 26), g - 3, g + 26, g, bs.stone, 6, 6);
  cornice(bs.plain, x, z, a, 110, 26, g + 26, 1, 0.6, bs.stone);
  gableRoof(bs.roof, bs.plain, x, z, a, 110, 26, g + 26, 9, bs.tile, bs.stone);
  const [tx, tz] = T(-10, 0);
  walls(bs.wall, rect(tx, tz, a, 26, 66), g - 3, g + 23, g, bs.stone, 6, 6);
  gableRoof(bs.roof, bs.plain, tx, tz, a + Math.PI / 2, 66, 26, g + 23, 9, bs.tile, bs.stone);
  campanile(bs, tx, tz, g, 72, 24, a);
  for (const v of [-11, 11]) {
    const [wx, wz] = T(58, v);
    campanile(bs, wx, wz, g, 48, 11, a);
    domed(bs, wx, wz, g + 48, 3.5, 2);
  }
  markPoly(rect(x, z, a, 116, 32)); markPoly(rect(tx, tz, a, 32, 72));
  piazza(...T(98, 0), a, 60, 70);
}

function university([x, z], a) {
  const bs = bundle(x, z);
  const g = palazzo(bs, ground, x, z, a, 110, 36, 16);
  for (const u of [-24, 24]) domed(bs, x + u * Math.cos(a), z + u * Math.sin(a), g + 16, 11, 7);
  markPoly(rect(x, z, a, 116, 42));
  for (const v of [-60, 60]) {
    const px = x - v * Math.sin(a), pz = z + v * Math.cos(a);
    palazzo(bundle(px, pz), ground, px, pz, a, 90, 20, 11);
    markPoly(rect(px, pz, a, 96, 26));
  }
  piazza(x + 36 * Math.sin(a), z - 36 * Math.cos(a), a, 70, 18, false);
}

function market([x, z], a) {
  for (let k = 0; k < 4; k++) {
    const b = a + (k * Math.PI) / 2, px = x + Math.cos(b) * 55, pz = z + Math.sin(b) * 55;
    palazzo(bundle(px, pz), ground, px, pz, b + Math.PI / 2, 120, 18, 9);
    markPoly(rect(px, pz, b + Math.PI / 2, 124, 22));
  }
  piazza(x, z, a, 90, 90);
}

function stadium() {
  const { c: [x, z], rx, rz } = STADIUM, bs = bundle(x, z), g = ground(x, z), n = 40;
  const P = (s, k) => [x + rx * s * Math.cos((k / n) * Math.PI * 2), z + rz * s * Math.sin((k / n) * Math.PI * 2)];
  for (let k = 0; k < n; k++) {
    const [ax, az] = P(1, k), [bx, bz] = P(1, k + 1), [cx, cz] = P(0.72, k + 1), [dx, dz] = P(0.72, k);
    const len = Math.hypot(bx - ax, bz - az) / 7;
    bs.arches.poly([[ax, g - 3, az], [bx, g - 3, bz], [bx, g + 13, bz], [ax, g + 13, az]], bs.stone,
      [(ax + bx) / 2 - x, 0, (az + bz) / 2 - z], [[0, 1], [len, 1], [len, 0], [0, 0]]);
    bs.plain.poly([[ax, g + 13, az], [bx, g + 13, bz], [cx, g + 1, cz], [dx, g + 1, dz]], [226, 216, 196], [x - ax, 2, z - az]);
  }
  cap(bs.plain, Array.from({ length: n }, (_, k) => P(0.72, k)), g + 0.3, GRASS);
  markCircle(x, z, rx + 5);
}

function industry(l) {
  const [x, z] = l.at, bs = bundle(x, z), g = ground(x, z);
  if (l.type === 'gasworks') for (const u of [-25, 25]) {
    walls(bs.plain, circle(x + u, z, 16, 16), g - 2, g + 20, g, [150, 146, 140], 99, 99, 0.85);
    cap(bs.plain, circle(x + u, z, 16, 16), g + 20, [120, 116, 110]);
  }
  if (l.type === 'power') {
    palazzo(bs, ground, x, z, l.a, 70, 34, 16);
    for (const u of [-15, 15]) walls(bs.plain, circle(x + u, z + 25, 3, 8), g, g + 55, g, [170, 90, 70], 99, 99, 0.85);
  }
  if (l.type === 'sheds') for (let k = 0; k < 4; k++) {
    const px = x + k * 26 * Math.cos(l.a + 1.57), pz = z + k * 26 * Math.sin(l.a + 1.57);
    walls(bs.facade.shuttered, rect(px, pz, l.a, 80, 14), g - 2, g + 5, g, bs.stone);
    gableRoof(bs.roof, bs.plain, px, pz, l.a, 80, 14, g + 5, 3, [150, 90, 70], bs.stone);
  }
  markCircle(x, z, 70);
}

// --- Water edge ---------------------------------------------------------------

function embankment() {
  for (let k = 0; k < RIVER.length - 1; k++) {
    const a = RIVER[k], b = RIVER[k + 1];
    if (Math.min(a.w, b.w) < LAKE_MIN_WIDTH) continue;
    const L = Math.hypot(b.x - a.x, b.z - a.z), tx = (b.x - a.x) / L, tz = (b.z - a.z) / L;
    let nx = -tz, nz = tx;
    const pt = river(a.x + nx * a.w * 1.5, a.z + nz * a.w * 1.5);
    if (!pt.cityBank) { nx = -nx; nz = -nz; }
    const steps = Math.ceil(L / 7), shore = [];
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, w = a.w + (b.w - a.w) * t;
      const x = a.x + (b.x - a.x) * t + nx * (w + 1), z = a.z + (b.z - a.z) * t + nz * (w + 1);
      const r = river(x, z);
      shore.push(Math.abs(r.d - r.w) < 4 && r.cityBank ? [x, z] : null);
    }
    for (let s = 0; s < shore.length - 1; s++) {
      if (!shore[s] || !shore[s + 1]) continue;
      const [x0, z0] = shore[s], [x1, z1] = shore[s + 1], bs = bundle(x0, z0);
      const top = ground(x0 + nx * 16, z0 + nz * 16) + 0.3;
      const len = Math.hypot(x1 - x0, z1 - z0) / 7, span = (top + 6.2) / (top + 1.2);   // one arch row above the waterline
      bs.arches.poly([[x0, -5, z0], [x1, -5, z1], [x1, top + 1.2, z1], [x0, top + 1.2, z0]], shade(STONE, 0.97), [-nx, 0, -nz],
        [[0, span], [len, span], [len, 0], [0, 0]]);
      bs.plain.poly([[x0, top, z0], [x1, top, z1], [x1, top + 1.2, z1], [x0, top + 1.2, z0]], STONE, [nx, 0, nz]);
      bs.plain.poly([[x0, top + 1.2, z0], [x1, top + 1.2, z1], [x1 + nx, top + 1.2, z1 + nz], [x0 + nx, top + 1.2, z0 + nz]], STONE, [0, 1, 0]);
      bs.paving.poly([[x0 + nx, top, z0 + nz], [x1 + nx, top, z1 + nz], [x1 + nx * 16, top, z1 + nz * 16], [x0 + nx * 16, top, z0 + nz * 16]], PAVING, [0, 1, 0], { xz: 2.4 });
      markSegment([x0 + nx * 8, z0 + nz * 8], [x1 + nx * 8, z1 + nz * 8], 16, PAVED | FLAGS);
      if (s % 3 === 1) prop('lamp', x0 + nx * 2.2, z0 + nz * 2.2);
      if (s % 9 === 5) benchFacing(x0 + nx * 3.5, z0 + nz * 3.5, x0 - nx * 10, z0 - nz * 10);
      // Alternating cypress and plane along the promenade, as in Powell's views.
      if (s % 3 === 0) plant(s % 6 ? 'plane' : 'cypress', x0 + nx * 13, z0 + nz * 13, 0.75, { onPaving: true });
    }
  }
}

let deck = null;
function bridge() {
  const [ax, az] = BRIDGE.a, [bx, bz] = BRIDGE.b, w = BRIDGE.width / 2;
  const L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
  const y = Math.max(ground(ax, az), ground(bx, bz)) + 0.4;
  deck = { ax, az, tx, tz, L, w, y };
  const bs = bundle(ax, az), u = L / 25, span = (y + 6.2) / (y + 1.2);
  for (const s of [-1, 1]) {
    const o = [nx * w * s, nz * w * s];
    bs.arches.poly([[ax + o[0], -5, az + o[1]], [bx + o[0], -5, bz + o[1]], [bx + o[0], y + 1.2, bz + o[1]], [ax + o[0], y + 1.2, az + o[1]]],
      bs.stone, [o[0], 0, o[1]], [[0, span], [u, span], [u, 0], [0, 0]]);
    bs.plain.poly([[ax + o[0] * 0.9, y, az + o[1] * 0.9], [bx + o[0] * 0.9, y, bz + o[1] * 0.9], [bx + o[0] * 0.9, y + 1.2, bz + o[1] * 0.9], [ax + o[0] * 0.9, y + 1.2, az + o[1] * 0.9]],
      bs.stone, [-o[0], 0, -o[1]]);
  }
  bs.paving.poly([[ax + nx * w, y, az + nz * w], [bx + nx * w, y, bz + nz * w], [bx - nx * w, y, bz - nz * w], [ax - nx * w, y, az - nz * w]], PAVING, [0, 1, 0], { xz: 2.4 });
}
export function deckHeight(x, z) {
  if (!deck) return -Infinity;
  const s = (x - deck.ax) * deck.tx + (z - deck.az) * deck.tz, o = Math.abs((x - deck.ax) * -deck.tz + (z - deck.az) * deck.tx);
  return s > -5 && s < deck.L + 5 && o < deck.w ? deck.y : -Infinity;
}

// --- Park paths, avenue, planting ----------------------------------------------

// A winding gravel path: straight line bent by Perlin noise, pinned at both ends.
function parkPath(a, b, wiggle = 35, seed = 0) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(4, Math.ceil(L / 12));
  const nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L, pts = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, off = perlin(t * L / 90 + seed, seed * 1.3) * wiggle * Math.sin(t * Math.PI);
    pts.push([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + nz * off]);
  }
  ribbon(pts, 3.6, [200, 184, 150], { lift: 0.2 });
  for (let k = 3; k < pts.length - 1; k += 4) {
    const [x, z] = pts[k], [x2, z2] = pts[k + 1], l = Math.hypot(x2 - x, z2 - z), side = k % 8 < 4 ? 1 : -1;
    const bx = x - (z2 - z) / l * 3.2 * side, bz = z + (x2 - x) / l * 3.2 * side;
    benchFacing(bx, bz, x, z);
  }
}

function parkPaths() {
  const depts = Array.from({ length: 8 }, (_, k) => { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; return [Math.cos(a) * 205, Math.sin(a) * 205]; });
  depts.forEach((p, k) => parkPath(p, depts[(k + 1) % 8], 18, k));              // loop round the Parliament terrace
  const toSH = [[-380, 140], [320, 250], [185, -556], [475, -344]];
  toSH.forEach((p, k) => parkPath(p, [STATE_HALL[0], STATE_HALL[1]], 45, 10 + k));
  depts.forEach((p, k) => { if (k % 2) parkPath(p, [p[0] * 1.75, p[1] * 1.75], 30, 20 + k); });   // out to the park edge
  parkPath([-380, 140], [320, 250], 60, 31);
}

function planting() {
  // Axis avenue: Parliament -> State Hall -> Cathedral, broken round the State Hall, lined with planes.
  const u = [Math.cos(AXIS_ANGLE), Math.sin(AXIS_ANGLE)], at = (p, s) => [p[0] + u[0] * s, p[1] + u[1] * s];
  for (const [p, q] of [[at(PARLIAMENT, 150), at(STATE_HALL, -60)], [at(STATE_HALL, 60), at(CATHEDRAL, -70)]]) {
    ribbon([p, q], 16, STREET, { lift: 0.24 });
    for (const side of [-1, 1]) ribbon([p, q], 4, PAVING, { lift: 0.3, kind: 'paving', uv: { plane: 2.4 }, offset: side * 10 });
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    for (let s = 0; s < L; s += 14) for (const o of [-14, 14]) plant('plane', p[0] + u[0] * s - u[1] * o, p[1] + u[1] * s + u[0] * o, 0.85);
  }
  // Ring boulevard: planes on the footpaths.
  for (const [a, b] of boulevards) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), t = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    for (let s = 10; s < L - 10; s += 16) for (const o of [-4.4, 4.4]) plant('plane', a[0] + t[0] * s - t[1] * o, a[1] + t[1] * s + t[0] * o, 0.7, { onPaving: true });
  }
  // Wooded park: eucalypt clumps with planes and cypress near the buildings, glades between.
  const [ax, az] = PARK.a, [bx, bz] = PARK.b;
  const where = (x, z) => inPark(x, z) && onLand(x, z, 5);
  scatter('eucalypt', (ax + bx) / 2, (az + bz) / 2, 520, 520, 900, { where, freq: 160, clump: 0.0, minS: 0.8, maxS: 1.2 });
  scatter('plane', (ax + bx) / 2, (az + bz) / 2, 520, 520, 350, { where, freq: 120, clump: 0.15, minS: 0.8, maxS: 1.1 });
  scatter('cypress', (ax + bx) / 2, (az + bz) / 2, 520, 520, 150, { where: (x, z) => where(x, z) && Math.hypot(x, z) < 320, freq: 60, clump: 0.1 });
  // Poplars along the unembanked river banks.
  for (let k = 0; k < RIVER.length - 1; k++) {
    const a = RIVER[k], b = RIVER[k + 1], L = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 0; s < L; s += 22) for (const side of [-1, 1]) {
      const t = s / L, w = (a.w + (b.w - a.w) * t) + (side > 0 ? 0 : a.far + (b.far - a.far) * t) + 14;
      const nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L, x = a.x + (b.x - a.x) * t + nx * w * side, z = a.z + (b.z - a.z) * t + nz * w * side;
      if (perlin(x / 200, z / 200) > -0.1 && !(river(x, z).cityBank && a.w >= LAKE_MIN_WIDTH)) plant('poplar', x, z, 0.8 + (perlin(x, z) + 1) * 0.2);
    }
  }
  // The shared 1911 bush on the hills and paddocks, kept out of the park and the city.
  naturalBush({ keepClear: (x, z) => inPark(x, z) || Math.hypot(x - STATE_HALL[0], z - STATE_HALL[1]) <= 1500 });
}

export function buildCity() {
  buildRings();
  buildGrid();
  for (const l of LANDMARKS) {
    const bs = bundle(...l.at);
    if (l.type === 'parliament') parliament(l.at);
    else if (l.type === 'stateHall') stateHall(l.at, l.a);
    else if (l.type === 'cathedral') cathedral(l.at, l.a);
    else if (l.type === 'university') university(l.at, l.a);
    else if (l.type === 'market') market(l.at, l.a);
    else if (l.type === 'stadium') stadium();
    else if (l.type === 'palazzo') {
      palazzo(bs, ground, l.at[0], l.at[1], l.a, l.w, l.d, l.h, l); markPoly(rect(l.at[0], l.at[1], l.a, l.w + 6, l.d + 6));
      if (l.name.includes('Residence')) gardenWall(l.at[0], l.at[1], l.a, l.w + 60, l.d + 50);
    }
    else if (l.type === 'square') piazza(l.at[0], l.at[1], l.a, 130, 90);
    else if (l.type === 'fields') { cap(bs.plain, rect(l.at[0], l.at[1], l.a, 300, 150), ground(...l.at) + 0.2, GRASS); markPoly(rect(l.at[0], l.at[1], l.a, 300, 150), PAVED); }
    else industry(l);
  }
  embankment();
  bridge();
  ribbon(RAIL, 6, [96, 86, 74], { lift: 0.3 });
  parkPaths();
  planting();
  return B;
}


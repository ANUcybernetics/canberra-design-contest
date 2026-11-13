// Gimson's plan, as data. Everything here is a rough reading of the plan image
// assets/gimson_plan.jpg (Cusack's reproduction, 726x615 px) and the Powell
// watercolours in reference/gimson/. Refine by editing numbers, not code.
//
// World units are metres: x east, z south, y up. Origin = Parliament on
// Kurrajong Hill. Water level is y = 0. The landform itself (hills, the 1911 river line)
// is shared and lives in ../../base/site.js; this file is only what Gimson put on it.
import { MOLONGLO_1911 } from '../../base/site.js';

export const PLAN = { img: 'assets/gimson_plan.jpg', w: 726, h: 615, ox: 245, oy: 355, scale: 6 };
export const planToWorld = (px, py) => [(px - PLAN.ox) * PLAN.scale, (py - PLAN.oy) * PLAN.scale];
export const worldToPlan = (x, z) => [x / PLAN.scale + PLAN.ox, z / PLAN.scale + PLAN.oy];

// Gimson's widths on the shared 1911 Molonglo centreline: the half-width of the water in metres
// on the city bank, plus extra width on the far bank (Powell's aerial shows a broad lake).
// Wide (>= 150 m) stretches are Gimson's lake; the city bank there is embanked.
const WIDTHS = [[35, 0], [50, 20], [165, 160], [200, 260], [250, 320], [250, 320], [230, 280], [190, 200], [110, 80], [55, 20], [45, 0], [40, 0]];
export const RIVER = MOLONGLO_1911.map(([x, z], k) => ({ x, z, w: WIDTHS[k][0], far: WIDTHS[k][1] }));
export const LAKE_MIN_WIDTH = 150;

export const PARLIAMENT = [0, 0];
export const STATE_HALL = [330, -450];          // on Camp Hill; the street rings centre here
export const CATHEDRAL = [640, -870];           // Cathedral -> State Hall -> Parliament axis
export const AXIS_ANGLE = Math.atan2(CATHEDRAL[1] - PARLIAMENT[1], CATHEDRAL[0] - PARLIAMENT[0]);

// Wooded central park: a capsule from Parliament to the State Hall.
export const PARK = { a: PARLIAMENT, b: STATE_HALL, r: 360 };

// Street rings around the State Hall, Sitte-style irregular sectors.
export const RINGS = { centre: STATE_HALL, r0: 340, step: 115, count: 10, sector: 135, maxR: 1320 };

// A small grid district running south-east along the river towards the industry.
export const SE_GRID = { origin: [1250, 420], dir: [0.8, 0.6], cellU: 130, cellV: 110, nu: 8, nv: 4 };

// Level pads carved into the ground: [x, z, radiusX, radiusZ]
export const FLATTEN = [
  [0, 0, 170, 170], [330, -450, 90, 90], [-390, 510, 110, 90],
  [-540, -1990, 130, 95], [-1140, -60, 170, 90], [1170, 30, 90, 90],
];

export const BRIDGE = { a: [-250, -1150], b: [-500, -1860], width: 14 };
export const STADIUM = { c: [-540, -1990], rx: 110, rz: 72 };
export const RAIL = [[560, -30], [600, 150], [640, 330], [660, 420], [645, 520], [620, 640]]
  .map(([px, py]) => planToWorld(px, py));

const perp = [Math.cos(AXIS_ANGLE + Math.PI / 2), Math.sin(AXIS_ANGLE + Math.PI / 2)];
const along = (p, s, t = 0) => [p[0] + Math.cos(AXIS_ANGLE) * s + perp[0] * t, p[1] + Math.sin(AXIS_ANGLE) * s + perp[1] * t];
const SQUARE = along(STATE_HALL, 290);

// type drives the look in city.js; clear = radius kept free of houses.
export const LANDMARKS = [
  { name: 'Houses of Parliament', type: 'parliament', at: PARLIAMENT, a: 0, clear: 300 },
  { name: 'State Hall', type: 'stateHall', at: STATE_HALL, a: AXIS_ANGLE, clear: 120 },
  { name: 'Printing Office', type: 'palazzo', at: along(STATE_HALL, 0, -190), a: AXIS_ANGLE, w: 60, d: 30, h: 12, clear: 60 },
  { name: 'Mint', type: 'palazzo', at: along(STATE_HALL, 0, 190), a: AXIS_ANGLE, w: 60, d: 30, h: 12, clear: 60 },
  { name: 'Cathedral', type: 'cathedral', at: CATHEDRAL, a: AXIS_ANGLE, clear: 120 },
  { name: 'Public Square', type: 'square', at: SQUARE, a: AXIS_ANGLE, clear: 90 },
  { name: 'National Art Gallery', type: 'palazzo', at: along(SQUARE, 0, -85), a: AXIS_ANGLE + Math.PI / 2, w: 64, d: 28, h: 15, domes: 1, clear: 50 },
  { name: 'National Library', type: 'palazzo', at: along(SQUARE, 0, 85), a: AXIS_ANGLE + Math.PI / 2, w: 64, d: 28, h: 15, domes: 1, clear: 50 },
  { name: 'National Theatre', type: 'palazzo', at: along(CATHEDRAL, -40, 140), a: AXIS_ANGLE, w: 50, d: 60, h: 18, domes: 1, clear: 60 },
  { name: 'General Post Office', type: 'palazzo', at: along(CATHEDRAL, -40, -140), a: AXIS_ANGLE, w: 60, d: 30, h: 16, tower: 38, clear: 60 },
  { name: 'City Hall', type: 'palazzo', at: [-600, -300], a: 0, w: 70, d: 40, h: 16, tower: 46, clear: 80 },
  { name: 'Courts of Justice', type: 'palazzo', at: [-690, -300], a: Math.PI / 2, w: 50, d: 28, h: 14, clear: 40 },
  { name: 'Courts of Justice', type: 'palazzo', at: [-510, -300], a: Math.PI / 2, w: 50, d: 28, h: 14, clear: 40 },
  { name: 'University', type: 'university', at: [-390, 510], a: 0.2, clear: 190 },
  { name: 'Market', type: 'market', at: [1170, 30], a: 0.3, clear: 110 },
  { name: 'Technical Colleges', type: 'palazzo', at: [1120, 210], a: 0.3, w: 80, d: 30, h: 14, clear: 60 },
  { name: "Governor-General's Residence", type: 'palazzo', at: [-380, 140], a: 0.4, w: 34, d: 20, h: 10, clear: 70 },
  { name: "Prime Minister's Residence", type: 'palazzo', at: [320, 250], a: -0.3, w: 30, d: 18, h: 10, clear: 70 },
  { name: 'Stadium', type: 'stadium', at: STADIUM.c, a: 0, clear: 150 },
  { name: 'Playing fields', type: 'fields', at: [-1140, -60], a: 0, clear: 180 },
  { name: 'Barracks', type: 'palazzo', at: [-950, 750], a: 0, w: 110, d: 24, h: 10, clear: 90 },
  { name: 'Gas Works', type: 'gasworks', at: [2250, 1250], a: 0.6, clear: 80 },
  { name: 'Power Station', type: 'power', at: [2420, 1100], a: 0.6, clear: 80 },
  { name: 'Cattle Market', type: 'sheds', at: [2100, 1480], a: 0.6, clear: 80 },
];

// Viewpoints for keys 1-8: from [x, z, height above ground], to [x, z, height above ground].
export const VIEWS = [
  { name: 'Parliament forecourt', from: [0, 180, 1.7], to: [0, 0, 30] },
  { name: 'Public Square to the Cathedral', from: [...along(SQUARE, -30), 1.7], to: [...CATHEDRAL, 35] },
  { name: 'Across the lake to the embankment', from: [760, -1960, 2], to: [640, -900, 25] },
  { name: 'On the bridge', from: [-470, -1760, 1.7], to: [-150, -900, 10] },
  { name: 'Aerial, after Powell', from: [-1500, -3600, 750], to: [500, -300, 0], fly: true },
  { name: 'Mount Ainslie summit', from: [2600, -3800, 3], to: [330, -450, 0] },
  { name: 'University', from: [-300, 330, 1.7], to: [-390, 510, 15] },
  { name: 'Market', from: [1040, -10, 1.7], to: [1170, 30, 8] },
];

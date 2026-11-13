// The shared Canberra site: the world frame and the natural landform that every
// vision is built on. Nothing here belongs to any one competition entry.
//
// World units are metres: x east, z south, y up. The origin is the summit of
// Kurrajong Hill (now Capital Hill). This is close to a true geographic frame,
// because the competitors all drew on the same 1911 contour survey, but the
// hills below are still a toy landform read by eye, not survey or LiDAR data.
// See docs/visions-plan.md for replacing them with a real DEM.

export const WATER = 0;                 // the single water plane every vision currently shares
export const GRID = { size: 14000, step: 20 };

// Where the landform's small-scale noise is damped, so the central basin reads as gently
// undulating ground. Camp Hill (Gimson's State Hall) happens to be the centre.
export const CALM = { centre: [330, -450], inner: 1300, outer: 2600 };

// The 1911 hills: [x, z, height m, radiusX, radiusZ]. Toy values, read by eye against
// Gimson's plan. Checked 2026-11-09: these are 0.35-4.3 km from the real summits (Ainslie is
// about 1.6 km out), so they are placeholders until the base moves to a real DEM.
export const HILLS = [
  [0, 0, 36, 260, 260],            // Kurrajong Hill (Capital Hill)
  [330, -450, 22, 200, 200],       // Camp Hill
  [-390, 510, 14, 180, 180],       // knoll south-west of Kurrajong (Gimson's University hill)
  [-700, 3000, 150, 900, 600],     // Red Hill
  [2600, -3800, 230, 700, 700],    // Mount Ainslie
  [4300, -3100, 210, 900, 900],    // Mount Majura
  [-3100, -2700, 230, 650, 650],   // Black Mountain
  [1900, -2000, 45, 350, 350],     // Mount Pleasant
  [2600, 4600, 180, 1100, 900],    // Mugga
  [-4200, 1800, 90, 800, 800],     // western ridge
];

// The 1911 Molonglo, as a centreline in metres, listed west to east. Read off Gimson's plan,
// which is drawn on the 1911 contour survey, so it follows the river as it was before any
// vision. A vision attaches its own widths to these points or draws its own water system.
export const MOLONGLO_1911 = [
  [-4470, -1170], [-1470, -1410], [-750, -1500], [-150, -1380], [510, -1260], [1110, -1020],
  [1350, -630], [1500, -90], [1890, 330], [2430, 690], [2910, 990], [5730, 2430],
];

// Named places on the shared ground, for viewpoints any vision can reuse.
export const PLACES = {
  kurrajong: [0, 0], campHill: [330, -450], ainslie: [2600, -3800], blackMountain: [-3100, -2700], redHill: [-700, 3000],
};

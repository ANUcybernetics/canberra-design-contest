// Every vision that can be loaded onto the shared base, by id (?vision=<id>).
// Loaded lazily so only the chosen one's code and data run.
export const TITLES = { bare: 'Bare site, 1911', gimson: 'Gimson, 1911' };
export const VISIONS = {
  bare: () => import('./bare/index.js'),
  gimson: () => import('./gimson/index.js'),
};
export const DEFAULT_VISION = 'gimson';

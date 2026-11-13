// A minimap for visions without a scanned plan: shaded relief of the current terrain,
// with the water in blue. Same shape as a vision's `plan`: { img, w, h, ox, oy, scale }
// (ox, oy = the pixel of the world origin; scale = metres per pixel).
import { ground, groundColourAt, WATER } from './terrain.js';

export function reliefPlan({ w = 700, h = 600, ox = 330, oy = 300, scale = 12 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
    const x = (px - ox) * scale, z = (py - oy) * scale, y = ground(x, z);
    const shade = 1 + (ground(x - scale, z - scale) - y) * 0.04;        // lit from the north-west
    const col = y < WATER + 0.3 ? [120, 150, 170] : groundColourAt(x, z).map((v) => v * Math.max(0.6, Math.min(1.35, shade)));
    img.data.set([...col, 255], (py * w + px) * 4);
  }
  g.putImageData(img, 0, 0);
  return { img: c.toDataURL(), w, h, ox, oy, scale };
}

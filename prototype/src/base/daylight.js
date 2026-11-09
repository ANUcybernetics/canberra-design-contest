// Time of day -> sun direction, light colours, sky tint, night factor. A toy model for
// Canberra in spring: the sun rises in the east, stands in the north at noon (about 58°
// up) and sets in the west. At night the directional light becomes a weak bluish moon.

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export function daylight(hour) {
  const th = (Math.PI * (hour - 6)) / 12;
  const elev = 58 * Math.sin(th), e = (elev * Math.PI) / 180, ce = Math.cos(Math.max(e, 0));
  let dir = [Math.cos(th) * ce, Math.sin(e), -Math.sin(th) * ce];
  const day = smooth(-6, 8, elev), low = 1 - smooth(3, 28, elev), night = 1 - smooth(-5, 5, elev);
  let lightColor = mix([1, 0.95, 0.86], [1, 0.6, 0.34], low), intensity = 1.6 * smooth(-1, 6, elev);
  if (elev < -1) {   // moon, roughly opposite the sun
    dir = [-dir[0] * 0.6, 0.6, -dir[2] * 0.6 - 0.3];
    lightColor = [0.6, 0.7, 1]; intensity = 0.22 * night;
  }
  const l = Math.hypot(...dir);
  return {
    hour, elev, night,
    dir: dir.map((v) => v / l),
    lightColor, intensity,
    ambient: mix([0.09, 0.1, 0.16], mix([0.48, 0.5, 0.55], [0.52, 0.44, 0.4], low * 0.6), day),
    skyTint: mix([0.07, 0.09, 0.18], mix([1, 1, 1], [1.02, 0.78, 0.62], low * 0.85), day),
  };
}

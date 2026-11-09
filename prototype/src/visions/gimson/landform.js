// What Gimson does to the shared ground: widens the Molonglo into an embanked lake,
// cuts level pads for the big buildings, and lays lawns over the park and the city.
import { RIVER, LAKE_MIN_WIDTH, FLATTEN, RINGS, PARK } from './layout.js';
import { riverChannel } from '../../base/waterways.js';
import { water } from '../../base/terrain.js';

export const channel = riverChannel({ points: RIVER, ref: RINGS.centre, lakeMinWidth: LAKE_MIN_WIDTH });
// Nearest point on the river: distance, local half-width, cityBank (on the State Hall side).
export const river = (x, z) => water(x, z);

const inParkT = (x, z) => {
  const [ax, az] = PARK.a, [bx, bz] = PARK.b, dx = bx - ax, dz = bz - az;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - ax - dx * t, z - az - dz * t) < PARK.r;
};
const LAWN = [118, 150, 80];
function tint(x, z, c, mix) {
  const [cx, cz] = RINGS.centre;
  if (inParkT(x, z)) return mix(c, LAWN, 0.75);
  if (Math.hypot(x - cx, z - cz) < RINGS.maxR + 100 && channel.query(x, z).cityBank) return mix(c, LAWN, 0.45);
  return c;
}

export const landform = { water: channel, flatten: FLATTEN, tint };

// The site as the competitors were given it in 1911: the Molonglo at its natural width
// winding across the plain, the hills, eucalypt woodland and paddock trees. Nothing built.
// This is the base on its own, and the check that the base needs no vision to stand up.
import { MOLONGLO_1911, PLACES } from '../../base/site.js';
import { riverChannel } from '../../base/waterways.js';
import { naturalBush } from '../../base/bush.js';
import { plant } from '../../base/vegetation.js';
import { Batches } from '../../base/kit.js';
import { reliefPlan } from '../../base/relief.js';

// The river at about its 1911 width: 15–25 m of water, gently sloping banks.
const W = [12, 14, 15, 14, 16, 15, 14, 15, 16, 15, 14, 14];
const channel = riverChannel({ points: MOLONGLO_1911.map(([x, z], k) => ({ x, z, w: W[k], far: 0 })), ref: PLACES.kurrajong });

function build() {
  // River oaks along the banks (casuarinas, drawn here with the poplar shape for now).
  const P = channel.points;
  for (let k = 0; k < P.length - 1; k++) {
    const a = P[k], b = P[k + 1], L = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / L, nz = (b.x - a.x) / L;
    for (let s = 0; s < L; s += 30) for (const side of [-1, 1]) {
      const t = s / L, o = (a.w + 10 + ((s * 7) % 13)) * side;
      plant('poplar', a.x + (b.x - a.x) * t + nx * o, a.z + (b.z - a.z) * t + nz * o, 0.7);
    }
  }
  naturalBush();
  return new Batches();
}

export default {
  id: 'bare',
  title: 'The bare site, 1911',
  blurb: 'The Limestone Plains as the competitors were given them: the Molonglo at its natural width, the hills and the bush. Nothing is built. The landform is a toy, not survey data.',
  landform: { water: channel },
  build,
  landmarks: [
    { name: 'Kurrajong Hill', at: PLACES.kurrajong }, { name: 'Camp Hill', at: PLACES.campHill },
    { name: 'Mount Ainslie', at: PLACES.ainslie }, { name: 'Black Mountain', at: PLACES.blackMountain }, { name: 'Red Hill', at: PLACES.redHill },
  ].map((l) => ({ ...l, clear: 300 })),
  views: [
    { name: 'Kurrajong Hill', from: [0, 60, 1.7], to: [600, -1300, 5] },
    { name: 'Down on the Molonglo', from: [-150, -1330, 1.7], to: [1110, -1020, 3] },
    { name: 'Aerial over the plain', from: [-1500, -3600, 750], to: [500, -300, 0], fly: true },
    { name: 'Mount Ainslie summit', from: [2600, -3800, 3], to: [330, -450, 0] },
  ],
  defaultView: 1,
  plan: () => reliefPlan(),
};

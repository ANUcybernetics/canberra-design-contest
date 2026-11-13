// The natural 1911 vegetation every vision starts with: eucalypt woodland and granite
// boulders on the big hills, and scattered paddock trees on the plain. A vision calls
// naturalBush() once, after its own buildings and planting, so trees keep off what it built.
import { HILLS } from './site.js';
import { ground } from './terrain.js';
import { scatter } from './vegetation.js';

// keepClear(x, z) -> true where the vision wants no paddock trees (its parks, its city centre).
export function naturalBush({ keepClear = () => false } = {}) {
  for (const [hx, hz, amp, rx, rz] of HILLS) {
    if (amp < 60) continue;
    scatter('eucalypt', hx, hz, rx * 1.5, rz * 1.5, 800, { freq: 450, clump: -0.05, minS: 1.1, maxS: 1.8 });
    scatter('rock', hx, hz, rx * 1.2, rz * 1.2, 500, { freq: 120, clump: 0.12, minS: 0.6, maxS: 2.4, where: (x, z) => ground(x, z) > 45 });
  }
  scatter('eucalypt', 0, 0, 6000, 6000, 1000, { freq: 900, clump: 0.2, minS: 1, maxS: 1.6, where: (x, z) => !keepClear(x, z) });
}

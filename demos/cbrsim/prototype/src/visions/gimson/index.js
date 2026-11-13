// Ernest Gimson's 1911 entry, illustrated by Alfred Powell.
import { landform } from './landform.js';
import { buildCity, deckHeight, inPark } from './city.js';
import { LANDMARKS, VIEWS, PLAN } from './layout.js';

export default {
  id: 'gimson',
  title: "Gimson's Canberra, 1911",
  blurb: "A rough walk-through sketch of Ernest Gimson's competition entry. The buildings are placeholders, not a reconstruction.",
  landform,                        // given to initTerrain() before anything is built
  build: buildCity,                // -> Batches of meshes, after the terrain exists
  deckHeight,                      // walkable surfaces over water (the bridge)
  isWooded: inPark,                // for birdsong
  landmarks: LANDMARKS,
  views: VIEWS,
  defaultView: 3,
  plan: PLAN,                      // minimap image and how its pixels map to metres
};

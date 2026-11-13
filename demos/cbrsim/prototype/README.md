# Canberra Visions — walk-around sketch (v0.2)

A PlayCanvas sketch for walking around different visions of Canberra on one shared base landscape. Two visions exist so far: **the bare 1911 site** and **Ernest Gimson's 1911 competition entry**. Choose one with the Vision menu or `?vision=bare|gimson`. The landscape is a toy, not LiDAR, and every Gimson building uses the same generic Mediterranean kit. `../docs/visions-plan.md` sets out how the other entries will be added.

## Run

```sh
cd prototype && python3 -m http.server 8123
```

Open http://127.0.0.1:8123. There's no build step; PlayCanvas loads from jsDelivr.

- **Click** to capture the mouse, then **WASD** to move and **Shift** to run
- **F** switches to flying; **E**/**Q** move up and down
- **1–9** jump to the vision's viewpoints
- **Click the minimap** (the vision's plan, or shaded relief) to teleport there
- **H** hides the help panel
- **P** shows performance stats
- **[** / **]** change the time of day, and **T** lets time pass (there's also a slider in the bottom-left panel)
- **R** toggles lake reflections, **O** ambient occlusion, **V** the watercolour look, **M** sound (sound starts on your first click)
- On a tablet: the joystick moves, dragging looks around, and ▲▼ fly
- Walking collides with buildings, walls and the lake edge; flying doesn't
- URL options: `?vision=bare` picks the vision; `?view=5` sets the starting viewpoint; `&hour=19.5`, `&ssao`, `&watercolour`, `&noreflect`; `?cam=x,z,h,tx,tz,th` sets any camera; `&clean` hides the HUD; `&stats` shows the stats

## Where things live

The code is split into the **base**, which every vision shares, and the **visions**, each of which says what it builds on that base. Switching vision reloads the page, because each vision reshapes the ground.

| File | What to edit |
|---|---|
| `src/main.js` | Loads the vision from `?vision=`, builds the scene, and runs the walk and fly controls, HUD and minimap. Contains no vision-specific code |
| `src/base/site.js` | **The shared site as data.** The world frame, the 1911 hills, the 1911 Molonglo centreline and named places |
| `src/base/terrain.js` | Natural ground from `site.js`, plus the vision's `landform`: its water model, level pads and ground tint. Call `initTerrain(landform)` once, before anything reads the ground |
| `src/base/waterways.js` | Water models a vision can use. So far `riverChannel` (a centreline with widths, optionally embanked where it widens into a lake) |
| `src/base/bush.js` | The natural 1911 vegetation every vision starts from: woodland and boulders on the hills, paddock trees |
| `src/base/relief.js` | Generates a shaded-relief minimap for visions without a scanned plan |
| `src/base/kit.js` | The geometry kit: walls with weathering, cornice, hip, gable and pyramid roofs, chimney, dome, campanile, palazzo, plus noise-displaced lumps and limbs for trees and rocks |
| `src/base/noise.js`, `texgen.js` | Perlin noise, and the textures generated from it at startup |
| `src/base/vegetation.js` | Tree species, rocks, lamps, benches and grass tufts, drawn with hardware instancing |
| `src/base/occupancy.js` | A 4 m grid recording what's built or paved, so planting stays off streets and buildings |
| `src/base/water.js`, `daylight.js`, `audio.js`, `touch.js` | Lake shader, time of day, synthesised sound, tablet controls |
| `src/visions/index.js` | The registry of visions. Add a line here for each new vision |
| `src/visions/bare/index.js` | The bare site: the river at its natural width, the bush and named hills |
| `src/visions/gimson/index.js` | The Gimson vision's descriptor: title, landform, builder, landmarks, viewpoints, plan |
| `src/visions/gimson/layout.js` | **Gimson's design as data.** River widths, the axis, street rings, landmark positions and sizes, viewpoints. Most refinement happens here |
| `src/visions/gimson/landform.js` | Gimson's lake, level pads and lawns |
| `src/visions/gimson/city.js` | Assembles Gimson's street rings, blocks, houses, landmarks, embankment arcade, bridge, stadium, park and trees |
| `assets/gimson_plan.jpg` | The plan the Gimson layout was read from (Cusack's reproduction) |
| `../reference/` | Source images: `gimson/` (Powell's watercolours and the plan), plus `australian/`, `french/` and `gummer/` (NLA scans, each with a `SOURCE.md`) |

A vision is a module whose default export is `{ id, title, blurb, landform, build(), deckHeight?, isWooded?, landmarks, views, defaultView, plan }`. `plan` is either a scanned image with its pixel-to-metre mapping or a function that returns one.

Coordinates: x runs east and z south, in metres, with the origin on Kurrajong Hill. Gimson's plan image is 6 m per pixel. `planToWorld` and `worldToPlan` (in `main.js`, built from the vision's `plan`) convert between the two, so the minimap dot lines up with the plan.

## Render budget

The target is a standard desktop with an integrated or mid-range GPU: about 1.5M triangles and fewer than 400 draw calls in the camera pass.

Measured with the P overlay, at street level, in the park, on the hills and across the lake: **about 260–270 draw calls and 1.0–1.2M triangles**, before the shadow passes. Shadows are 3 cascades out to 600 m. The lake reflection draws the World layer a second time from a mirrored camera at half resolution, without the Detail layer (roads, paving, tufts). Reflections (R) and SSAO (O) are the two biggest costs to switch off on a weak GPU.

The levers are `LOD` at the top of `src/main.js`, the scatter counts in `planting()` in `src/visions/gimson/city.js`, and `GRID.step` in `src/base/site.js`:

- Terrain chunks switch to a 1/16 mesh beyond 2.2 km.
- Trees switch to one-lump stand-ins beyond 1.3 km.
- Footpath tiles drop out beyond 2.5 km.
- Grass tufts exist only within 70 m of the viewer.

## Known roughness (next iterations)

- Scale and positions are read by eye from a small plan image. The lake width is exaggerated on the far bank to match Powell's aerial.
- The landmarks are placeholders built from the same kit. The Cathedral crossing tower and the Parliament X-plan are only gestures.
- The street rings are a stylised Sitte pattern. They don't trace Gimson's actual streets.
- The residential areas beyond the rings, the tram routes and the rail yards are mostly missing.

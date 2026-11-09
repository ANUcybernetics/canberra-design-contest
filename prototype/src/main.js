import * as pc from 'https://cdn.jsdelivr.net/npm/playcanvas@2/build/playcanvas.mjs';
import { initTerrain, terrainChunks, ground, water as nearestWater, WATER } from './base/terrain.js';
import { speciesBuilders, instances, tuftBuilder, tuftField, TUFT_TINTS } from './base/vegetation.js';
import { occupied, BUILT, PAVED, FLAGS } from './base/occupancy.js';
import { createWater } from './base/water.js';
import { daylight } from './base/daylight.js';
import { createAudio } from './base/audio.js';
import { createTouch } from './base/touch.js';
import * as T from './base/texgen.js';
import { VISIONS, TITLES, DEFAULT_VISION } from './visions/index.js';

// --- The vision: what is built on the shared ground (?vision=<id>) ----------------------------
const q = new URLSearchParams(location.search);
const visionId = VISIONS[q.get('vision')] ? q.get('vision') : DEFAULT_VISION;
const V = (await VISIONS[visionId]()).default;
initTerrain(V.landform);
const { landmarks: LANDMARKS = [], views: VIEWS } = V;
const PLAN = typeof V.plan === 'function' ? V.plan() : V.plan;
document.getElementById('nviews').textContent = Math.min(9, VIEWS.length);
const deckHeight = V.deckHeight || (() => -Infinity);
const isWooded = V.isWooded || (() => false);
const planToWorld = (px, py) => [(px - PLAN.ox) * PLAN.scale, (py - PLAN.oy) * PLAN.scale];
const worldToPlan = (x, z) => [x / PLAN.scale + PLAN.ox, z / PLAN.scale + PLAN.oy];
document.title = V.title;
document.querySelector('#help h1').textContent = V.title;
document.getElementById('blurb').textContent = V.blurb;
// Switching vision reloads the page: each vision reshapes the ground, so nothing is shared at runtime.
const visionEl = document.getElementById('vision');
for (const id of Object.keys(VISIONS)) visionEl.add(new Option(TITLES[id] || id, id, false, id === visionId));
// The camera comes along, so you can compare visions from the same spot.
visionEl.addEventListener('change', () => {
  const u = new URL(location), yaw = player.yaw * Math.PI / 180, pitch = player.pitch * Math.PI / 180;
  const tx = player.x - Math.sin(yaw) * Math.cos(pitch) * 200, tz = player.z - Math.cos(yaw) * Math.cos(pitch) * 200, ty = player.y + Math.sin(pitch) * 200;
  const cam = [player.x, player.z, player.y - ground(player.x, player.z), tx, tz, ty - ground(tx, tz)].map((v) => v.toFixed(1)).join(',');
  u.searchParams.set('vision', visionEl.value); u.searchParams.delete('view'); u.searchParams.set('cam', cam);
  location = u;
});

const canvas = document.getElementById('app');
const app = new pc.Application(canvas, {
  mouse: new pc.Mouse(canvas), keyboard: new pc.Keyboard(window),
  graphicsDeviceOptions: { antialias: true },
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());
const device = app.graphicsDevice;

// Draw-distance budget (metres).
const LOD = { terrain: 2200, trees: 1300, props: 900, paving: 2500, tufts: 70 };
// Toggles (keys in brackets): reflections [R], ambient occlusion [O], watercolour [V], sound [M].
const settings = { reflections: !q.has('noreflect'), ssao: q.has('ssao'), watercolour: q.has('watercolour'), hour: parseFloat(q.get('hour') || '15.5'), animate: false };

// --- Layers: World (also reflected), Detail (small stuff, not reflected), Water ---------------
const layers = app.scene.layers;
const worldLayer = layers.getLayerByName('World');
const detailLayer = new pc.Layer({ name: 'Detail' }), waterLayer = new pc.Layer({ name: 'Water' });
layers.insertOpaque(detailLayer, layers.getOpaqueIndex(worldLayer) + 1);
layers.insertOpaque(waterLayer, layers.getOpaqueIndex(detailLayer) + 1);

// --- Materials -------------------------------------------------------------------
if (typeof app.scene.fog === 'object') Object.assign(app.scene.fog, { type: pc.FOG_LINEAR, start: 3000, end: 32000 });

function texture(canvasEl, srgb = true, clampV = false) {
  const tex = new pc.Texture(device, {
    width: canvasEl.width, height: canvasEl.height, format: srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8,
    mipmaps: true, minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT, addressV: clampV ? pc.ADDRESS_CLAMP_TO_EDGE : pc.ADDRESS_REPEAT, anisotropy: 8,
  });
  tex.setSource(canvasEl);
  return tex;
}
function mat(opts, gen) {
  const m = new pc.StandardMaterial();
  m.diffuse = new pc.Color(1, 1, 1);
  m.diffuseVertexColor = true;
  m.gloss = 0.2; m.metalness = 0; m.useMetalness = true;
  if (gen) {
    m.diffuseMap = texture(gen.color);
    if (gen.normal) { m.normalMap = texture(gen.normal, false); m.bumpiness = 0.9; }
    if (gen.glow) { m.emissiveMap = texture(gen.glow); m.emissive = new pc.Color(0, 0, 0); }
  }
  Object.assign(m, opts);
  m.update();
  return m;
}
// Wind: bend vertices above `base` metres (in the mesh's own space) with two sines, phased by
// the instance's world position so neighbouring trees don't sway in step.
const WIND_VS = pc.ShaderChunks.get(device, pc.SHADERLANGUAGE_GLSL).get('transformCoreVS')
  .replace('vec3 getLocalPosition(vec3 vertexPosition) {\n\tvec3 localPos = vertexPosition;', `uniform float uWindTime;
uniform vec2 uWind;
vec3 getLocalPosition(vec3 vertexPosition) {
\tvec3 localPos = vertexPosition;
\tvec3 inst = getModelMatrix()[3].xyz;
\tfloat ph = dot(inst.xz, vec2(0.071, 0.053));
\tfloat h = max(localPos.y - uWind.y, 0.0);
\tfloat s = (sin(uWindTime * 1.3 + ph) + 0.4 * sin(uWindTime * 3.1 + ph * 1.7 + localPos.x * 0.5)) * uWind.x * h;
\tlocalPos.x += s; localPos.z += s * 0.6;`);
const windOk = WIND_VS.includes('uWindTime');
function addWind(m, amp, base) {
  if (!windOk) return;
  m.shaderChunksVersion = pc.CHUNKAPI_2_8;
  m.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('transformCoreVS', WIND_VS);
  m.setParameter('uWind', [amp, base]);
  m.update();
}

const facade = (g) => mat({}, g);
const MATS = {
  arched: facade(T.facades.arched()), shuttered: facade(T.facades.shuttered()), balcony: facade(T.facades.balcony()),
  arcade: facade(T.facades.arcade()), arches: mat({}, T.arches()),
  roof: mat({ gloss: 0.25 }, T.roofTiles()), road: mat({ gloss: 0.1 }, T.gravel()), paving: mat({ gloss: 0.3 }, T.paving()),
  plain: mat({}), foliage: mat({ gloss: 0.1 }), props: mat({ gloss: 0.15 }),
  lamp: mat({ emissiveVertexColor: true, emissive: new pc.Color(0, 0, 0) }),
  gold: mat({ metalness: 0.7, gloss: 0.6 }),
  terrain: mat({
    gloss: 0.08, diffuseDetailMap: texture(T.detail().color), diffuseDetailMapTiling: new pc.Vec2(0.11, 0.11),
    diffuseDetailMode: pc.DETAILMODE_OVERLAY,
  }, T.grass()),
  tuft: mat({ alphaTest: 0.5, opacityMapChannel: 'a', cull: pc.CULLFACE_NONE, gloss: 0.05 }),
};
MATS.tuft.diffuseMap = texture(T.blades().color); MATS.tuft.opacityMap = MATS.tuft.diffuseMap; MATS.tuft.update();
addWind(MATS.foliage, 0.012, 2.5);
addWind(MATS.tuft, 0.16, 0);
const GLOWING = [MATS.arched, MATS.shuttered, MATS.balcony, MATS.arcade];
const NO_SHADOW = new Set(['road', 'paving', 'terrain', 'tuft']);
const DETAIL = new Set(['road', 'paving', 'tuft']);

// Colours in the kit are authored as sRGB; the shader wants linear.
const LIN = Uint8Array.from({ length: 256 }, (_, v) => Math.round(Math.pow(v / 255, 2.2) * 255));
function toMesh({ positions, normals, uvs, colors, indices }, linearised = false) {
  if (!linearised) for (let k = 0; k < colors.length; k++) if ((k & 3) !== 3) colors[k] = LIN[colors[k]];
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions); mesh.setNormals(normals);
  if (uvs) mesh.setUvs(0, uvs);
  mesh.setColors32(colors); mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}
const fromBuilder = (b) => toMesh({
  positions: new Float32Array(b.p), normals: new Float32Array(b.n), uvs: new Float32Array(b.t),
  colors: new Uint8Array(b.c), indices: new Uint32Array(b.i),
});
const tracked = [];   // for the stats overlay
function addEntity(name, mis, kind) {
  tracked.push(...mis);
  const e = new pc.Entity(name);
  e.addComponent('render', {
    meshInstances: mis, castShadows: !NO_SHADOW.has(kind), receiveShadows: true,
    layers: [DETAIL.has(kind) ? detailLayer.id : worldLayer.id],
  });
  app.root.addChild(e);
  return e;
}

// Things whose visibility depends on distance: { near, far?, x, z | box, d }
const lodItems = [];

// --- Build -----------------------------------------------------------------------
const status = document.getElementById('status');

const terrainMIs = [];
for (const c of terrainChunks()) {
  const full = toMesh(c), coarse = toMesh({ ...c, indices: c.coarse }, true);
  const a = new pc.MeshInstance(full, MATS.terrain), b = new pc.MeshInstance(coarse, MATS.terrain);
  terrainMIs.push(a, b);
  lodItems.push({ near: a, far: b, x: c.cx, z: c.cz, d: LOD.terrain });
}
addEntity('terrain', terrainMIs, 'terrain');

const batches = V.build();
const byKind = {};
for (const { kind, b, cx, cz } of batches.map.values()) {
  if (!b.i.length) continue;
  const mi = new pc.MeshInstance(fromBuilder(b), MATS[kind]);
  (byKind[kind] ||= []).push(mi);
  if (kind === 'paving') lodItems.push({ near: mi, x: cx, z: cz, d: LOD.paving });
}
for (const [kind, mis] of Object.entries(byKind)) addEntity(kind, mis, kind);

// Instanced trees, rocks and street furniture: one vertex buffer per species per 2 km tile.
const nearMeshes = speciesBuilders(false), farMeshes = speciesBuilders(true);
const instFormat = pc.VertexFormat.getDefaultInstancingFormat(device);
const meshCache = {};
const speciesMesh = (key, far) => (meshCache[key + far] ||= fromBuilder((far ? farMeshes : nearMeshes)[key]));
const instMIs = { foliage: [], props: [], lamp: [] };
let instanceCount = 0;
for (const [key, arr] of Object.entries(instances)) {
  const kind = key.startsWith('lamp') ? 'lamp' : key.startsWith('bench') || key.startsWith('rock') ? 'props' : 'foliage';
  const isProp = key.startsWith('lamp') || key.startsWith('bench');
  const tiles = new Map();
  for (let k = 0; k < arr.length; k += 5) {
    const t = `${Math.floor(arr[k] / 2000)}:${Math.floor(arr[k + 2] / 2000)}`;
    if (!tiles.has(t)) tiles.set(t, []);
    tiles.get(t).push(k);
  }
  for (const list of tiles.values()) {
    const data = new Float32Array(list.length * 16), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    list.forEach((k, n) => {
      const [x, y, z, s, r] = arr.slice(k, k + 5), c = Math.cos(r) * s, si = Math.sin(r) * s;
      data.set([c, 0, -si, 0, 0, s, 0, 0, si, 0, c, 0, x, y, z, 1], n * 16);
      lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], y); lo[2] = Math.min(lo[2], z);
      hi[0] = Math.max(hi[0], x); hi[1] = Math.max(hi[1], y); hi[2] = Math.max(hi[2], z);
    });
    instanceCount += list.length;
    const vb = new pc.VertexBuffer(device, instFormat, list.length, { data });
    const aabb = new pc.BoundingBox(
      new pc.Vec3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2 + 8, (lo[2] + hi[2]) / 2),
      new pc.Vec3((hi[0] - lo[0]) / 2 + 10, (hi[1] - lo[1]) / 2 + 12, (hi[2] - lo[2]) / 2 + 10));
    const pair = (isProp ? [false] : [false, true]).map((far) => {
      const mi = new pc.MeshInstance(speciesMesh(key, far), MATS[kind]);
      mi.setInstancing(vb); mi.setCustomAabb(aabb);
      instMIs[kind].push(mi);
      return mi;
    });
    // Tiles are 2 km, so judge near/far from the closest point of the tile's box.
    lodItems.push({ near: pair[0], far: pair[1], box: aabb, d: isProp ? LOD.props : LOD.trees });
  }
}
for (const [kind, mis] of Object.entries(instMIs)) if (mis.length) addEntity(kind, mis, kind);

// Grass tufts: dynamic instance buffers (one per ground tint), re-scattered around the viewer.
const TUFT_MAX = 7000;
const tufts = TUFT_TINTS.map((tint) => {
  const vb = new pc.VertexBuffer(device, instFormat, TUFT_MAX, { usage: pc.BUFFER_DYNAMIC });
  const mi = new pc.MeshInstance(fromBuilder(tuftBuilder(tint)), MATS.tuft);
  mi.setInstancing(vb); mi.instancingCount = 0;
  return { vb, mi };
});
const tuftEntity = addEntity('tufts', tufts.map((t) => t.mi), 'tuft');
let tuftAt = null;
function updateTufts(x, z) {
  const fields = tuftField(x, z, LOD.tufts, TUFT_MAX);
  const box = new pc.BoundingBox(new pc.Vec3(x, ground(x, z), z), new pc.Vec3(LOD.tufts, 40, LOD.tufts));
  fields.forEach(({ data, count }, k) => { tufts[k].vb.setData(data); tufts[k].mi.instancingCount = count; tufts[k].mi.setCustomAabb(box); });
  tuftAt = [x, z];
}

// Painted sky dome that follows the camera; its emissive colour is tinted by the time of day.
const skyMat = new pc.StandardMaterial();
skyMat.useLighting = false; skyMat.useFog = false; skyMat.diffuse = new pc.Color(0, 0, 0);
skyMat.emissive = new pc.Color(1, 1, 1); skyMat.emissiveMap = texture(T.sky().color, true, true);
skyMat.cull = pc.CULLFACE_FRONT; skyMat.depthWrite = false; skyMat.update();
const skyMesh = (() => {
  const p = [], n = [], c = [], uv = [], idx = [], lat = 24, lon = 48, r = 30000;
  for (let i = 0; i <= lat; i++) for (let j = 0; j <= lon; j++) {
    const t = -Math.PI / 2 + (i / lat) * Math.PI, f = (j / lon) * Math.PI * 2;
    p.push(r * Math.cos(t) * Math.cos(f), r * Math.sin(t), r * Math.cos(t) * Math.sin(f)); n.push(0, 1, 0);
    c.push(255, 255, 255, 255); uv.push(j / lon, 1 - i / lat);
  }
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
    const a = i * (lon + 1) + j, b = a + lon + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  return toMesh({ positions: new Float32Array(p), normals: new Float32Array(n), uvs: new Float32Array(uv), colors: new Uint8Array(c), indices: new Uint32Array(idx) }, true);
})();
const sky = new pc.Entity('sky');
sky.addComponent('render', { meshInstances: [new pc.MeshInstance(skyMesh, skyMat)], castShadows: false, receiveShadows: false, layers: [worldLayer.id] });
app.root.addChild(sky);

const sun = new pc.Entity('sun');
sun.addComponent('light', {
  type: 'directional', color: new pc.Color(1, 0.95, 0.86), intensity: 1.5,
  castShadows: true, shadowDistance: 600, shadowResolution: 2048, numCascades: 3, cascadeDistribution: 0.7,
  shadowBias: 0.3, normalOffsetBias: 0.06, layers: [worldLayer.id, detailLayer.id],
});
app.root.addChild(sun);

const camera = new pc.Entity('camera');
camera.addComponent('camera', { nearClip: 0.5, farClip: 40000, fov: 65, toneMapping: pc.TONEMAP_ACES });
camera.camera.layers = [...camera.camera.layers, detailLayer.id, waterLayer.id];
app.root.addChild(camera);

const water = createWater(pc, app, { camera, worldLayer, waterLayer, makeTexture: texture });

// --- Time of day ---------------------------------------------------------------------
const env = { night: 0, fogColor: new pc.Color(), fogStart: 3000, fogEnd: 32000, sunDir: [0, 1, 0], sunColor: [1, 1, 1], skyColor: [1, 1, 1] };
function applyDaylight() {
  const d = daylight(settings.hour);
  sun.setPosition(0, 0, 0);
  sun.lookAt(new pc.Vec3(...d.dir)); sun.rotateLocal(-90, 0, 0);   // light shines along its -Y
  sun.light.color = new pc.Color(...d.lightColor);
  sun.light.intensity = d.intensity;
  app.scene.ambientLight = new pc.Color(...d.ambient);
  const hor = T.SKY_HORIZON.map((v, i) => v * d.skyTint[i]);
  env.fogColor.set(...hor);
  if (typeof app.scene.fog === 'object') app.scene.fog.color = env.fogColor;
  camera.camera.clearColor = env.fogColor;
  skyMat.emissive = new pc.Color(...d.skyTint); skyMat.update();
  env.night = d.night; env.sunDir = d.dir; env.sunColor = d.lightColor.map((v) => v * Math.min(1, d.intensity)); env.skyColor = hor;
  const glow = new pc.Color(1, 0.8, 0.5).mulScalar(d.night * 0.7);
  for (const m of GLOWING) { m.emissive = glow; m.update(); }
  MATS.lamp.emissive = new pc.Color(1, 0.9, 0.7).mulScalar(d.night * 1.3); MATS.lamp.update();
  const label = document.getElementById('hourLabel');
  if (label) label.textContent = `${String(Math.floor(settings.hour)).padStart(2, '0')}:${String(Math.floor((settings.hour % 1) * 60)).padStart(2, '0')}`;
}

// --- Post-processing: ambient occlusion and the watercolour look (CameraFrame) ------------------
let frame = null;
const paperEl = document.getElementById('paper');
paperEl.style.backgroundImage = `url(${T.paper().toDataURL()})`;
function applyPost() {
  const need = settings.ssao || settings.watercolour;
  if (need && !frame) frame = new pc.CameraFrame(app, camera.camera);
  if (frame) {
    frame.enabled = need;
    if (need) {
      frame.rendering.toneMapping = pc.TONEMAP_ACES;
      frame.ssao.type = settings.ssao ? pc.SSAOTYPE_LIGHTING : pc.SSAOTYPE_NONE;
      Object.assign(frame.ssao, { radius: 6, intensity: 0.7, samples: 12, power: 4 });
      frame.grading.enabled = settings.watercolour;
      Object.assign(frame.grading, { saturation: 0.78, contrast: 0.88, brightness: 1.06 });
      Object.assign(frame.vignette, { intensity: settings.watercolour ? 0.55 : 0, inner: 0.35, outer: 1.25, curvature: 0.6 });
      frame.vignette.color = new pc.Color(0.45, 0.36, 0.25);
      frame.update();
    }
  }
  document.body.classList.toggle('watercolour', settings.watercolour);
  water.reflections = settings.reflections;
  syncToggles();
}

// --- Distance LOD / culling ----------------------------------------------------------
function boxDist(box, x, y, z) {
  const c = box.center, h = box.halfExtents;
  const dx = Math.max(0, Math.abs(x - c.x) - h.x), dy = Math.max(0, Math.abs(y - c.y) - h.y), dz = Math.max(0, Math.abs(z - c.z) - h.z);
  return Math.hypot(dx, dy, dz);
}
function updateLod() {
  const { x, y, z } = player;
  for (const it of lodItems) {
    const d = it.box ? boxDist(it.box, x, y, z) : Math.hypot(x - it.x, z - it.z);
    const near = d < it.d;
    it.near.visible = near;
    if (it.far) it.far.visible = !near;
  }
}

// --- Walk / fly controls, with collision ---------------------------------------------------
const EYE = 1.7;
const walkY = (x, z) => Math.max(ground(x, z), deckHeight(x, z), WATER) + EYE;
const player = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, fly: false };
// Walking: buildings and walls block, and so does the lake (except on the bridge).
const blocked = (x, z) => (occupied(x, z) & BUILT) || (ground(x, z) < WATER + 0.3 && deckHeight(x, z) === -Infinity);
function walkTo(nx, nz) {
  if (!blocked(nx, nz) || blocked(player.x, player.z)) { player.x = nx; player.z = nz; }   // free to escape if spawned inside
  else if (!blocked(nx, player.z)) player.x = nx;
  else if (!blocked(player.x, nz)) player.z = nz;
}

function lookFrom(fx, fz, y, tx, tz, ty) {
  player.x = fx; player.z = fz; player.y = y;
  const dx = tx - fx, dz = tz - fz;
  player.yaw = Math.atan2(-dx, -dz) * pc.math.RAD_TO_DEG;
  player.pitch = Math.atan2(ty - y, Math.hypot(dx, dz)) * pc.math.RAD_TO_DEG;
}
function goTo(v) {
  const [fx, fz, fh] = v.from, [tx, tz, th] = v.to;
  player.fly = !!v.fly;
  lookFrom(fx, fz, v.fly ? ground(fx, fz) + fh : walkY(fx, fz) + (fh - EYE), tx, tz, ground(tx, tz) + th);
  flash(v.name);
}

const audio = createAudio();
const touch = createTouch(document.body);
canvas.addEventListener('click', () => { if (!touch.active) canvas.requestPointerLock?.(); audio.start(); });
canvas.addEventListener('pointerdown', () => audio.start(), { once: true });
let dragging = false;
app.mouse.on(pc.EVENT_MOUSEDOWN, () => { dragging = true; });
app.mouse.on(pc.EVENT_MOUSEUP, () => { dragging = false; });
app.mouse.on(pc.EVENT_MOUSEMOVE, (e) => {
  if (touch.active || (!pc.Mouse.isPointerLocked() && !dragging)) return;
  player.yaw -= e.dx * 0.12;
  player.pitch = Math.max(-89, Math.min(89, player.pitch - e.dy * 0.12));
});

const statsEl = document.getElementById('stats');
const toggle = (k, msg) => { settings[k] = !settings[k]; applyPost(); flash(`${msg} ${settings[k] ? 'on' : 'off'}`); };
app.keyboard.on(pc.EVENT_KEYDOWN, (e) => {
  if (e.key === pc.KEY_F) { player.fly = !player.fly; if (!player.fly) player.y = walkY(player.x, player.z); flash(player.fly ? 'Fly mode' : 'Walk mode'); }
  if (e.key === pc.KEY_H) document.getElementById('help').classList.toggle('hidden');
  if (e.key === pc.KEY_P) statsEl.classList.toggle('hidden');
  if (e.key === pc.KEY_R) toggle('reflections', 'Reflections');
  if (e.key === pc.KEY_O) toggle('ssao', 'Ambient occlusion');
  if (e.key === pc.KEY_V) toggle('watercolour', 'Watercolour');
  if (e.key === pc.KEY_M) flash(audio.toggleMute() ? 'Sound off' : 'Sound on');
  if (e.key === pc.KEY_T) { settings.animate = !settings.animate; flash(settings.animate ? 'Time passing' : 'Time paused'); }
  if (e.key === pc.KEY_OPEN_BRACKET || e.key === pc.KEY_CLOSE_BRACKET) setHour(settings.hour + (e.key === pc.KEY_OPEN_BRACKET ? -0.5 : 0.5));
  const n = e.key - pc.KEY_1;
  if (n >= 0 && n < VIEWS.length) goTo(VIEWS[n]);
});

// Settings panel.
const hourEl = document.getElementById('hour');
function setHour(h) { settings.hour = Math.min(21, Math.max(4.5, h)); hourEl.value = settings.hour; applyDaylight(); }
hourEl.addEventListener('input', () => setHour(parseFloat(hourEl.value)));
function syncToggles() { for (const k of ['reflections', 'ssao', 'watercolour']) document.getElementById(`t-${k}`).checked = settings[k]; }
for (const k of ['reflections', 'ssao', 'watercolour']) document.getElementById(`t-${k}`).addEventListener('change', (e) => { settings[k] = e.target.checked; applyPost(); });

let lodTimer = 0, fps = 60, windTime = 0;
const windScope = device.scope.resolve('uWindTime');
app.on('update', (dt) => {
  fps += (1 / Math.max(dt, 1e-3) - fps) * 0.05;
  windTime += dt; windScope.setValue(windTime);
  if (settings.animate) setHour(settings.hour >= 21 ? 4.5 : settings.hour + dt * 0.25);

  const K = app.keyboard, key = (...ks) => ks.some((k) => K.isPressed(k));
  const run = key(pc.KEY_SHIFT);
  const speed = player.fly ? (run ? 400 : 80) : (run ? 25 : 6);
  if (touch.active) { player.yaw -= touch.look[0] * 0.2; player.pitch = Math.max(-89, Math.min(89, player.pitch - touch.look[1] * 0.2)); touch.look = [0, 0]; }
  const yaw = player.yaw * pc.math.DEG_TO_RAD, pitch = player.pitch * pc.math.DEG_TO_RAD;
  const fwd = player.fly ? [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)] : [-Math.sin(yaw), 0, -Math.cos(yaw)];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const f = (key(pc.KEY_W, pc.KEY_UP) ? 1 : 0) - (key(pc.KEY_S, pc.KEY_DOWN) ? 1 : 0) + touch.move[1];
  const s = (key(pc.KEY_D, pc.KEY_RIGHT) ? 1 : 0) - (key(pc.KEY_A, pc.KEY_LEFT) ? 1 : 0) + touch.move[0];
  const mx = fwd[0] * f + right[0] * s, mz = fwd[2] * f + right[2] * s;
  let my = fwd[1] * f;
  if (player.fly) my += (key(pc.KEY_E, pc.KEY_SPACE) ? 1 : 0) - (key(pc.KEY_Q) ? 1 : 0) + touch.up;
  const ox = player.x, oz = player.z;
  if (player.fly) { player.x += mx * speed * dt; player.z += mz * speed * dt; player.y = Math.max(walkY(player.x, player.z), player.y + my * speed * dt); }
  else { walkTo(player.x + mx * speed * dt, player.z + mz * speed * dt); player.y += (walkY(player.x, player.z) - player.y) * Math.min(1, dt * 12); }
  camera.setPosition(player.x, player.y, player.z);
  camera.setEulerAngles(player.pitch, player.yaw, 0);
  sky.setPosition(player.x, 0, player.z);

  const height = player.y - ground(player.x, player.z);
  tuftEntity.enabled = height < 40;
  if (height < 40 && (!tuftAt || Math.hypot(player.x - tuftAt[0], player.z - tuftAt[1]) > 12)) updateTufts(player.x, player.z);
  if ((lodTimer -= dt) <= 0) { updateLod(); lodTimer = 0.25; }
  water.update(dt, { x: player.x, y: player.y, z: player.z }, player.pitch, player.yaw, env);

  const r = nearestWater(player.x, player.z), occ = occupied(player.x, player.z);
  audio.update(dt, {
    waterNear: 1 - Math.min(1, Math.max(0, (r.d - r.w) / 150)) * (r.w > 100 ? 1 : 1.5),
    height, walking: !player.fly, speed: Math.hypot(player.x - ox, player.z - oz) / Math.max(dt, 1e-3),
    trees: isWooded(player.x, player.z) ? 0.8 : ground(player.x, player.z) > 40 ? 0.5 : 0.15,
    surface: occ & FLAGS ? 'stone' : occ & PAVED ? 'gravel' : 'grass',
  });
  hud();
});

// --- HUD, stats, minimap on the vision's plan ------------------------------------------------------
const placeEl = document.getElementById('place'), flashEl = document.getElementById('flash');
let flashT;
function flash(msg) { flashEl.textContent = msg; flashEl.style.opacity = 1; clearTimeout(flashT); flashT = setTimeout(() => { flashEl.style.opacity = 0; }, 1800); }

const map = document.getElementById('minimap'), mctx = map.getContext('2d');
const planImg = new Image(); planImg.src = PLAN.img;
const MS = map.width / PLAN.w;
map.height = Math.round(PLAN.h * MS);
map.addEventListener('click', (e) => {
  const rc = map.getBoundingClientRect();
  const [x, z] = planToWorld((e.clientX - rc.left) / rc.width * PLAN.w, (e.clientY - rc.top) / rc.height * PLAN.h);
  player.x = x; player.z = z; if (!player.fly) player.y = walkY(x, z);
});
let statT = 0;
function hud() {
  let best = null, bd = 260;
  for (const l of LANDMARKS) { const d = Math.hypot(player.x - l.at[0], player.z - l.at[1]); if (d < bd) { bd = d; best = l.name; } }
  placeEl.textContent = best || '';
  mctx.clearRect(0, 0, map.width, map.height);
  if (planImg.complete) mctx.drawImage(planImg, 0, 0, map.width, map.height);
  const [px, py] = worldToPlan(player.x, player.z), yaw = player.yaw * pc.math.DEG_TO_RAD;
  mctx.fillStyle = '#d33'; mctx.strokeStyle = '#d33'; mctx.lineWidth = 2;
  mctx.beginPath(); mctx.arc(px * MS, py * MS, 4, 0, Math.PI * 2); mctx.fill();
  mctx.beginPath(); mctx.moveTo(px * MS, py * MS); mctx.lineTo(px * MS - Math.sin(yaw) * 14, py * MS - Math.cos(yaw) * 14); mctx.stroke();
  if (!statsEl.classList.contains('hidden') && (statT++ % 15 === 0)) {
    const fr = camera.camera.frustum, sphere = new pc.BoundingSphere();
    let calls = 0, tris = 0;
    for (const mi of tracked) {
      if (!mi.visible || !mi.node?.enabled) continue;
      const box = mi.aabb; sphere.center.copy(box.center); sphere.radius = box.halfExtents.length();
      if (!fr.containsSphere(sphere)) continue;
      const n = mi.instancingData ? mi.instancingCount : 1;
      if (!n) continue;
      calls++; tris += (mi.mesh.primitive[0].count / 3) * n;
    }
    statsEl.textContent = `${Math.round(fps)} fps · ~${calls} draw calls · ${(tris / 1e6).toFixed(2)}M tris (camera pass)\n` +
      `+ reflection pass ${settings.reflections ? 'on' : 'off'} · SSAO ${settings.ssao ? 'on' : 'off'} · wind ${windOk ? 'on' : 'unavailable'}\n` +
      `${instanceCount} instanced trees/rocks/props · ${tufts.reduce((a, t) => a + t.mi.instancingCount, 0)} tufts`;
  }
}

// Start at ?view=N (1-based), or ?cam=x,z,h,tx,tz,th for a custom camera. Default: across the lake.
if (q.has('cam')) {
  const [x, z, h, tx, tz, th] = q.get('cam').split(',').map(Number);
  lookFrom(x, z, ground(x, z) + h, tx, tz, ground(tx, tz) + th);
  player.fly = h > 5;
} else goTo(VIEWS[(parseInt(q.get('view') || String(V.defaultView || 1), 10) - 1) % VIEWS.length]);
if (q.has('clean')) document.body.classList.add('clean');
if (q.has('stats')) statsEl.classList.remove('hidden');
setHour(settings.hour);
applyPost();
updateLod();
status.remove();
app.start();

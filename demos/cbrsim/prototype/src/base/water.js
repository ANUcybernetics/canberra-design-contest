// The lake: planar reflection (a mirrored camera rendering into a half-res target),
// two scrolling Perlin normal maps for ripples, and a baked depth map for shallows
// and the shoreline. One ShaderMaterial; tone mapping and gamma follow the camera.
import { heights, GRID, WATER } from './terrain.js';
import { fractal } from './noise.js';

const VS = `
attribute vec3 aPosition;
uniform mat4 matrix_model;
uniform mat4 matrix_viewProjection;
varying vec3 vWorld;
varying vec4 vClip;
void main(void) {
  vec4 w = matrix_model * vec4(aPosition, 1.0);
  vWorld = w.xyz;
  gl_Position = matrix_viewProjection * w;
  vClip = gl_Position;
}`;

const FS = `
#include "gammaPS"
#include "tonemappingPS"
varying vec3 vWorld;
varying vec4 vClip;
uniform sampler2D uReflection;
uniform sampler2D uNormalMap;
uniform sampler2D uDepthMap;
uniform float uTime;
uniform float uReflect;
uniform vec3 view_position;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSkyColor;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform vec3 uTerrain;   // x0, z0, size

vec3 ripple(vec2 p) {
  vec2 a = texture2D(uNormalMap, p / 38.0 + vec2(uTime * 0.011, uTime * 0.006)).rg * 2.0 - 1.0;
  vec2 b = texture2D(uNormalMap, p / 13.0 - vec2(uTime * 0.017, -uTime * 0.013)).rg * 2.0 - 1.0;
  return normalize(vec3((a.x + b.x) * 0.35, 1.0, (a.y + b.y) * 0.35));
}

void main(void) {
  vec3 n = ripple(vWorld.xz);
  vec3 toEye = view_position - vWorld;
  float dist = length(toEye);
  vec3 v = toEye / dist;
  float cosT = max(dot(v, vec3(0.0, 1.0, 0.0)), 0.0);
  float fresnel = mix(0.28, 1.0, pow(1.0 - cosT, 3.0));

  vec2 screen = vClip.xy / vClip.w * 0.5 + 0.5;
  vec2 ruv = vec2(screen.x, 1.0 - screen.y) + n.xz * 0.025;
  vec3 refl = mix(uSkyColor, texture2D(uReflection, ruv).rgb, uReflect) * 0.82;

  // Depth under the surface, baked from the terrain: sandy shallows, darker deep water, a pale shore line.
  vec2 duv = (vWorld.xz - uTerrain.xy) / uTerrain.z;
  float depth = texture2D(uDepthMap, duv).r;
  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, 0.6, depth));
  float shore = 1.0 - smoothstep(0.0, 0.06, depth + n.x * 0.02);

  vec3 col = mix(body, refl, fresnel * smoothstep(0.0, 0.15, depth + 0.05));
  vec3 h = normalize(uSunDir + v);
  col += uSunColor * pow(max(dot(n, h), 0.0), 220.0) * 1.6;
  col = mix(col, uShallow * 1.25, shore * 0.6);

  float f = clamp((dist - uFog.x) / (uFog.y - uFog.x), 0.0, 1.0);
  col = mix(col, uFogColor, f);
  gl_FragColor = vec4(gammaCorrectOutput(toneMap(col)), 1.0);
}`;

const lin = (c) => c.map((v) => Math.pow(v, 2.2));

export function createWater(pc, app, { camera, worldLayer, waterLayer, makeTexture }) {
  const device = app.graphicsDevice;

  // Tileable ripple normal map from Perlin noise.
  const size = 256, nc = document.createElement('canvas'); nc.width = nc.height = size;
  const g = nc.getContext('2d'), img = g.createImageData(size, size), H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = fractal((x / size) * 6, (y / size) * 6, 4, 6);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = (i, j) => H[((j + size) % size) * size + ((i + size) % size)];
    const dx = (h(x - 1, y) - h(x + 1, y)) * 6, dy = (h(x, y - 1) - h(x, y + 1)) * 6, l = Math.hypot(dx, dy, 1);
    img.data.set([(dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, 255, 255], (y * size + x) * 4);
  }
  g.putImageData(img, 0, 0);
  const normalTex = makeTexture(nc, false);

  // Depth map: 0 at the waterline, 1 at 6 m down.
  const N = Math.round(Math.sqrt(heights.length)), dc = document.createElement('canvas'); dc.width = dc.height = N;
  const dg = dc.getContext('2d'), dimg = dg.createImageData(N, N);
  for (let k = 0; k < N * N; k++) { const d = Math.max(0, Math.min(1, (WATER - heights[k]) / 6)) * 255; dimg.data.set([d, d, d, 255], k * 4); }
  dg.putImageData(dimg, 0, 0);
  const depthTex = new pc.Texture(device, { width: N, height: N, format: pc.PIXELFORMAT_RGBA8, mipmaps: false,
    minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
  depthTex.setSource(dc);

  const material = new pc.ShaderMaterial({ uniqueName: 'CBRWater', vertexGLSL: VS, fragmentGLSL: FS, attributes: { aPosition: pc.SEMANTIC_POSITION } });
  material.setParameter('uNormalMap', normalTex);
  material.setParameter('uDepthMap', depthTex);
  const x0 = -GRID.size / 2;
  material.setParameter('uTerrain', [x0, x0, GRID.size + GRID.step]);
  material.setParameter('uDeep', lin([0.22, 0.34, 0.40]));
  material.setParameter('uShallow', lin([0.56, 0.60, 0.50]));
  material.update();

  const water = new pc.Entity('water');
  water.addComponent('render', { type: 'plane', material, castShadows: false, receiveShadows: false, layers: [waterLayer.id] });
  water.setLocalScale(30000, 1, 30000); water.setPosition(0, WATER, 0);
  app.root.addChild(water);

  // Reflection camera: mirrored through the water plane, oblique near plane clips the lake bed.
  let rt = null, scale = 0.5;
  const refl = new pc.Entity('reflection-camera');
  refl.addComponent('camera', {
    priority: -1, layers: [worldLayer.id], clearColor: new pc.Color(0.7, 0.78, 0.88), fov: camera.camera.fov,
    nearClip: 0.5, farClip: 14000, toneMapping: pc.TONEMAP_LINEAR, gammaCorrection: pc.GAMMA_NONE,
  });
  app.root.addChild(refl);
  const plane = [0, 1, 0, -(WATER - 0.2)];
  refl.camera.calculateProjection = (m) => {
    m.setPerspective(camera.camera.fov, camera.camera.aspectRatio, 0.5, 14000);
    const W = refl.getWorldTransform().data, d = m.data;
    const C = [0, 1, 2, 3].map((i) => W[i * 4] * plane[0] + W[i * 4 + 1] * plane[1] + W[i * 4 + 2] * plane[2] + W[i * 4 + 3] * plane[3]);
    const q = [(Math.sign(C[0]) + d[8]) / d[0], (Math.sign(C[1]) + d[9]) / d[5], -1, (1 + d[10]) / d[14]];
    const k = 2 / (C[0] * q[0] + C[1] * q[1] + C[2] * q[2] + C[3] * q[3]);
    d[2] = C[0] * k; d[6] = C[1] * k; d[10] = C[2] * k + 1; d[14] = C[3] * k;
  };
  function resize() {
    const w = Math.max(64, Math.floor(device.width * scale)), h = Math.max(64, Math.floor(device.height * scale));
    if (rt && rt.width === w && rt.height === h) return;
    rt?.destroyTextureBuffers(); rt?.destroy();
    const tex = new pc.Texture(device, { width: w, height: h, format: device.textureHalfFloatRenderable ? pc.PIXELFORMAT_RGBA16F : pc.PIXELFORMAT_RGBA8, mipmaps: false,
      minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE });
    rt = new pc.RenderTarget({ colorBuffer: tex, depth: true });
    refl.camera.renderTarget = rt;
    material.setParameter('uReflection', tex);
  }
  resize();

  let time = 0;
  return {
    entity: water,
    set reflections(on) { refl.enabled = on; material.setParameter('uReflect', on ? 1 : 0); },
    get reflections() { return refl.enabled; },
    set scale(s) { scale = s; resize(); },
    update(dt, p, pitch, yaw, env) {
      time += dt;
      resize();
      refl.setPosition(p.x, 2 * WATER - p.y, p.z);
      refl.setEulerAngles(-pitch, yaw, 0);
      refl.camera.fov = camera.camera.fov;
      refl.camera.clearColor = env.fogColor;
      material.setParameter('uTime', time);
      material.setParameter('uSunDir', env.sunDir);
      material.setParameter('uSunColor', lin(env.sunColor));
      material.setParameter('uSkyColor', lin(env.skyColor));
      material.setParameter('uFogColor', lin([env.fogColor.r, env.fogColor.g, env.fogColor.b]));
      material.setParameter('uFog', [env.fogStart, env.fogEnd]);
    },
  };
}

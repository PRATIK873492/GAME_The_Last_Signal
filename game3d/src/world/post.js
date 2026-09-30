/* =====================================================================
   POST-PROCESSING  (Phase 4) - the "cinematic" layer, built on the pmndrs
   `postprocessing` library + N8AO.

   Pass chain (HDR until tone mapping):
     1. Render    : background scene (sky, skyline) -> clear depth -> city
     2. N8AO      : ambient occlusion (dark contact shadows in corners)
     3. SSR       : screen-space reflections on WET ground (High/Ultra only)
     4. DoF       : depth of field while aiming / in cutscenes
     5. Motion    : camera motion blur at speed (reprojects last frame's matrix)
     6. Main pass : god rays + bloom + exposure & ACES tone mapping + LUT grade
     7. Lens pass : chromatic aberration (kicks on explosions) + vignette
     8. Final     : SMAA anti-aliasing + film grain
   The Low preset skips all of this and renders directly (fastest).
   ===================================================================== */
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, ClearPass, EffectPass, Effect, EffectAttribute, BlendFunction,
  BloomEffect, GodRaysEffect, DepthOfFieldEffect, LUT3DEffect, LookupTexture, VignetteEffect,
  NoiseEffect, ChromaticAberrationEffect, SMAAEffect, SMAAPreset, KernelSize,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

// ---------------------------------------------------------------------
// Custom effect 1: exposure + ACES filmic tone mapping (HDR -> display)
// ---------------------------------------------------------------------
class ExposureToneEffect extends Effect {
  constructor() {
    super('ExposureTone', `
      uniform float exposure;
      // ACES filmic curve (Stephen Hill's fit), same maths Three.js uses
      vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        const mat3 ACESIn = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
        const mat3 ACESOut = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
        vec3 c = inputColor.rgb * exposure / 0.6;
        c = ACESOut * RRTAndODTFit(ACESIn * c);
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`, { uniforms: new Map([['exposure', new THREE.Uniform(0.5)]]) });
  }
}

// ---------------------------------------------------------------------
// Custom effect 2: camera motion blur by reprojection.
// For each pixel: depth -> world position (this frame's inverse matrices),
// then project that world point with LAST frame's view-projection. The
// difference in screen position is the pixel's motion; we blur along it.
// ---------------------------------------------------------------------
class MotionBlurEffect extends Effect {
  constructor() {
    super('MotionBlur', `
      uniform mat4 invViewProj; uniform mat4 prevViewProj; uniform float intensity;
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec4 world = invViewProj * ndc; world /= world.w;
        vec4 prev = prevViewProj * world; prev.xy /= prev.w;
        vec2 vel = (uv - (prev.xy * 0.5 + 0.5)) * intensity;
        vel = clamp(vel, -0.04, 0.04);                       // cap the smear
        vec4 acc = inputColor;
        for (int i = 1; i < 8; i++) acc += texture2D(inputBuffer, uv - vel * (float(i) / 8.0));
        outputColor = acc / 8.0;
      }`, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map([['invViewProj', new THREE.Uniform(new THREE.Matrix4())], ['prevViewProj', new THREE.Uniform(new THREE.Matrix4())], ['intensity', new THREE.Uniform(0)]]),
    });
  }
}

// ---------------------------------------------------------------------
// Custom effect 3: screen-space reflections for wet streets.
// Only pixels whose surface faces UP (normal rebuilt from neighbouring
// depths) reflect. We march the reflected ray through the depth buffer;
// where it passes behind something, we take that pixel's colour.
// ---------------------------------------------------------------------
class WetSSREffect extends Effect {
  constructor() {
    super('WetSSR', `
      uniform mat4 proj; uniform mat4 invProj; uniform vec3 upView; uniform float wet;
      vec3 viewPos(vec2 uv) { float d = readDepth(uv); vec4 p = invProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        outputColor = inputColor;
        if (wet < 0.02 || depth >= 0.9999) return;
        vec3 P = viewPos(uv);
        vec3 N = normalize(cross(viewPos(uv + vec2(texelSize.x, 0.0)) - P, viewPos(uv + vec2(0.0, texelSize.y)) - P));
        if (dot(N, upView) < 0.0) N = -N;
        if (dot(N, upView) < 0.9) return;                       // only (near-)horizontal ground
        vec3 V = normalize(P);
        vec3 R = reflect(V, N);
        float fres = pow(1.0 - max(dot(-V, N), 0.0), 3.0);
        vec3 ray = P; float stepLen = 0.4; vec4 hit = vec4(0.0);
        for (int i = 0; i < 28; i++) {
          ray += R * stepLen; stepLen *= 1.18;
          vec4 c = proj * vec4(ray, 1.0); vec2 s = c.xy / c.w * 0.5 + 0.5;
          if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) break;
          float sceneZ = viewPos(s).z;
          if (sceneZ > ray.z && sceneZ - ray.z < stepLen * 2.5) {            // ray went behind a surface -> hit
            float edge = min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y));
            hit = vec4(texture2D(inputBuffer, s).rgb, smoothstep(0.0, 0.12, edge) * (1.0 - float(i) / 28.0));
            break;
          }
        }
        outputColor.rgb = mix(inputColor.rgb, hit.rgb, hit.a * wet * (0.25 + 0.55 * fres));
      }`, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      uniforms: new Map([['proj', new THREE.Uniform(new THREE.Matrix4())], ['invProj', new THREE.Uniform(new THREE.Matrix4())], ['upView', new THREE.Uniform(new THREE.Vector3(0, 1, 0))], ['wet', new THREE.Uniform(0)]]),
    });
  }
}

// ---------------------------------------------------------------------
// Colour grades baked into a 3D LUT. Each grade maps a display colour
// (0..1) to a new colour; we blend grades by time of day and bake the
// result into a 32x32x32 lookup texture every half second.
// ---------------------------------------------------------------------
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const GRADES = {
  // warm, slightly desaturated daylight (the blackout look)
  day: (r, g, b) => { const l = lum(r, g, b), s = 0.82; return [(l + (r - l) * s) * 1.03 + 0.01, (l + (g - l) * s) * 1.0 + 0.005, (l + (b - l) * s) * 0.93]; },
  // golden hour: push oranges, lift shadows warm
  golden: (r, g, b) => [r * 1.08 + 0.02, g * 0.98 + 0.01, b * 0.82],
  // cold blue night: shadows toward blue, muted colour
  // (shadows are lifted with a gamma curve so characters and streets stay readable, not black silhouettes)
  night: (r, g, b) => { const l = lum(r, g, b), s = 0.78, lift = v => Math.pow(Math.max(0, v), 0.72) * 0.94 + 0.025; return [lift((l + (r - l) * s) * 0.92), lift((l + (g - l) * s) * 0.98), lift((l + (b - l) * s) * 1.1)]; },
  // "Dawn" ending: bright, warm, saturated - the city lives again
  dawn: (r, g, b) => { const l = lum(r, g, b), s = 1.18; return [(l + (r - l) * s) * 1.1 + 0.03, (l + (g - l) * s) * 1.04 + 0.02, (l + (b - l) * s) * 0.9]; },
};
const contrast = (v, k) => (v - 0.5) * k + 0.5;

export function createPost({ renderer, scene, bg, camera, bgCamera, preset }) {
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  const passes = {};

  // 1. render both scenes into the same buffer; depth ends up as the city's
  const bgPass = new RenderPass(bg, bgCamera);
  const clearDepth = new ClearPass(false, true, false);
  const cityPass = new RenderPass(scene, camera); cityPass.clearPass.enabled = false;
  composer.addPass(bgPass); composer.addPass(clearDepth); composer.addPass(cityPass);

  // 2. ambient occlusion
  const ao = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
  ao.configuration.aoRadius = 2.2; ao.configuration.distanceFalloff = 1.2; ao.configuration.intensity = 2.4;
  ao.configuration.gammaCorrection = false;                     // we are still in linear HDR here
  composer.addPass(ao); passes.ao = ao;

  // 3. SSR (wet streets)
  const ssr = new WetSSREffect(); passes.ssr = new EffectPass(camera, ssr); composer.addPass(passes.ssr);

  // 4. depth of field
  const dof = new DepthOfFieldEffect(camera, { focusDistance: 8, focusRange: 5, bokehScale: 3, resolutionScale: 0.5 });
  passes.dof = new EffectPass(camera, dof); composer.addPass(passes.dof);

  // 5. motion blur
  const motion = new MotionBlurEffect(); passes.motion = new EffectPass(camera, motion); composer.addPass(passes.motion);

  // 6. god rays + bloom + tone mapping + LUT grade
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 3.6), transparent: true, depthWrite: false, fog: false }));
  sunDisc.frustumCulled = false; scene.add(sunDisc);
  const godrays = new GodRaysEffect(camera, sunDisc, { samples: 50, density: 0.95, decay: 0.93, weight: 0.45, exposure: 0.5, clampMax: 1, resolutionScale: 0.5, kernelSize: KernelSize.SMALL, blur: true });
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.3, intensity: 0.85, radius: 0.7 });
  const tone = new ExposureToneEffect();
  const lut = LookupTexture.createNeutral(32);
  const lutEffect = new LUT3DEffect(lut);
  passes.main = new EffectPass(camera, godrays, bloom, tone, lutEffect); composer.addPass(passes.main);

  // 7. lens: chromatic aberration + vignette
  const ca = new ChromaticAberrationEffect({ offset: new THREE.Vector2(0.0006, 0.0006), radialModulation: true, modulationOffset: 0.3 });
  const vignette = new VignetteEffect({ offset: 0.3, darkness: 0.55 });
  passes.lens = new EffectPass(camera, ca, vignette); composer.addPass(passes.lens);

  // 8. anti-aliasing + film grain
  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
  const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.ADD });
  grain.blendMode.opacity.value = 0.05;
  passes.final = new EffectPass(camera, smaa, grain); composer.addPass(passes.final);

  // ---------------- settings ----------------
  const settings = loadSettings(preset);
  function applySettings() {
    ao.enabled = settings.ao ?? preset.ao;                  // null = follow the preset
    ao.configuration.halfRes = preset.aoHalfRes;
    ao.setQualityMode(preset.aoQuality);
    bloom.blendMode.opacity.value = settings.bloom ? 1 : 0;
    godrays.blendMode.opacity.value = settings.godrays ? 1 : 0;
    passes.ssr.enabled = settings.ssr;
    grain.blendMode.opacity.value = settings.grain ? 0.05 : 0; vignette.blendMode.opacity.value = settings.grain ? 1 : 0;
  }
  applySettings();

  // ---------------- per-frame state ----------------
  const prevVP = new THREE.Matrix4(), curVP = new THREE.Matrix4(), lastCam = new THREE.Vector3();
  let caKick = 0, lutTimer = 0, dofBlend = 0, grade = { day: 1, golden: 0, night: 0, dawn: 0 };

  /** Bake the blended grade into the LUT (32^3 colours - cheap on the CPU). */
  function bakeLUT(w) {
    const d = lut.image.data, n = 32, s = 1 / (n - 1);
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
      const i = (r + g * n + b * n * n) * 4, R = r * s, G = g * s, B = b * s;
      let o0 = 0, o1 = 0, o2 = 0;
      for (const k in w) { if (!w[k]) continue; const o = GRADES[k](R, G, B); o0 += o[0] * w[k]; o1 += o[1] * w[k]; o2 += o[2] * w[k]; }
      const c = 1.06;                                        // a little extra contrast everywhere
      d[i] = contrast(o0, c); d[i + 1] = contrast(o1, c); d[i + 2] = contrast(o2, c); d[i + 3] = 1;
    }
    lut.needsUpdate = true;
  }

  return {
    composer, settings, passes,
    setSettings(patch) { Object.assign(settings, patch); saveSettings(settings); applySettings(); },
    setPreset(p) { preset = p; applySettings(); },
    setSize(w, h) { composer.setSize(w, h); ao.setSize?.(w, h); },
    /** Explosions etc. call this: a quick chromatic-aberration punch. */
    kick(amount = 1) { caKick = Math.min(1.5, caKick + amount); },
    /**
     * env: { dt, exposure, daylight, golden, sunDir, wet, aiming, focusDist, cinematic, dawnEnding }
     */
    render(env) {
      const { dt } = env;
      // --- grade weights: day / golden / night, or the Dawn ending ---
      const target = env.dawnEnding ? { day: 0, golden: 0, night: 0, dawn: 1 }
        : { day: env.daylight * (1 - env.golden), golden: env.daylight * env.golden, night: 1 - env.daylight, dawn: 0 };
      for (const k in grade) grade[k] += (target[k] - grade[k]) * Math.min(1, dt * 2);
      lutTimer -= dt; if (lutTimer <= 0) { lutTimer = 0.5; bakeLUT(grade); }

      tone.uniforms.get('exposure').value = env.exposure;

      // --- sun disc for god rays: far along the sun direction, facing the camera ---
      const far = camera.far * 0.9;
      sunDisc.position.copy(camera.position).addScaledVector(env.sunDir, far);
      sunDisc.scale.setScalar(far * 0.045);
      sunDisc.lookAt(camera.position);
      sunDisc.visible = env.sunDir.y > -0.03 && settings.godrays;
      // rays are strongest at golden hour and in hazy weather
      godrays.blendMode.opacity.value = settings.godrays ? Math.min(1, 0.35 + env.golden * 0.9 + env.haze * 0.4) * env.daylight : 0;

      // --- SSR only matters on wet streets ---
      ssr.uniforms.get('wet').value = env.wet;
      ssr.uniforms.get('proj').value.copy(camera.projectionMatrix);
      ssr.uniforms.get('invProj').value.copy(camera.projectionMatrixInverse);
      ssr.uniforms.get('upView').value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
      passes.ssr.enabled = settings.ssr && preset.ssr && env.wet > 0.02;

      // --- depth of field: focus on what you aim at, or the cutscene subject ---
      dofBlend += ((settings.dof && (env.aiming || env.cinematic) ? 1 : 0) - dofBlend) * Math.min(1, dt * 6);
      passes.dof.enabled = dofBlend > 0.02;
      dof.cocMaterial.focusDistance = env.focusDist;          // metres, in front of the camera
      dof.cocMaterial.focusRange = env.aiming ? 6 : 10;        // metres that stay sharp
      dof.bokehScale = (env.cinematic ? 1.6 : 3) * dofBlend;             // gentle in cutscenes, stronger when aiming

      // --- motion blur from camera speed (vehicles later; sprinting barely registers) ---
      curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      const speed = camera.position.distanceTo(lastCam) / Math.max(dt, 1e-4); lastCam.copy(camera.position);
      const mb = settings.motion ? THREE.MathUtils.clamp((speed - 7) / 15, 0, 1) : 0;
      passes.motion.enabled = mb > 0.01;
      motion.uniforms.get('intensity').value = mb * 0.6;
      motion.uniforms.get('invViewProj').value.copy(curVP).invert();
      motion.uniforms.get('prevViewProj').value.copy(prevVP);

      // --- chromatic aberration kick decays quickly ---
      caKick = Math.max(0, caKick - dt * 2.5);
      ca.offset.set(0.0006 + caKick * 0.012, 0.0006 + caKick * 0.008);

      composer.render(dt);
      prevVP.copy(curVP);
    },
  };
}

// Toggles remembered per browser; defaults follow the preset.
function loadSettings(preset) {
  // ssr defaults on; it only actually runs on presets that allow it (High/Ultra)
  const def = { ao: null, bloom: true, godrays: true, ssr: true, dof: true, motion: true, grain: true };
  try { return Object.assign(def, JSON.parse(localStorage.getItem('ls3d-post') || '{}')); } catch (e) { return def; }
}
function saveSettings(s) { try { localStorage.setItem('ls3d-post', JSON.stringify(s)); } catch (e) { /* storage blocked */ } }

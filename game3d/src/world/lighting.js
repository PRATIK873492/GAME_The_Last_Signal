/* =====================================================================
   SKY & LIGHTING  (Phase 3)
   - Two scenes: a BACKGROUND scene (sky, stars, moon, distant skyline,
     mountains; far clip 5 km) rendered first, then the playable city.
   - Sun = CASCADED SHADOW MAPS (CSM): 2-4 shadow maps split along the
     view distance -> sharp shadows near the player, softer far away.
     (Low preset: no shadows.)
   - Physically based sky (Rayleigh + Mie scattering) from the day clock:
     sunrise, golden hour, sunset, night with stars and moon.
   - Environment reflections are generated from that same sky, so glass,
     metal and wet streets reflect the current time of day.
   - Weather (from weather.js) dims the sun, thickens fog, tints the air.
   ===================================================================== */
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { CSM } from 'three/addons/csm/CSM.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const LIT = m => m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);

export function createLighting({ scene, bg, renderer, camera, preset }) {
  // ---------------- background: sky, stars, moon ----------------
  const sky = new Sky();
  const U = sky.material.uniforms;
  U.turbidity.value = 9; U.rayleigh.value = 2.2; U.mieCoefficient.value = 0.008; U.mieDirectionalG.value = 0.86;
  sky.scale.setScalar(4000);
  bg.add(sky);

  const starGeo = new THREE.BufferGeometry(), pts = [];
  for (let i = 0; i < 2200; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random());           // upper hemisphere
    pts.push(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 1.1, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat); stars.scale.setScalar(3000); bg.add(stars);

  const moonTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64); gr.addColorStop(0, 'rgba(235,240,255,1)'); gr.addColorStop(0.45, 'rgba(220,230,255,.9)'); gr.addColorStop(0.5, 'rgba(160,180,255,.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128); g.fillStyle = 'rgba(150,160,180,.35)'; for (const [x, y, r] of [[52, 55, 8], [74, 70, 6], [60, 78, 4]]) { g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, fog: false, depthWrite: false }));
  moonSprite.scale.setScalar(160); bg.add(moonSprite);

  // Haze dome: the sky shader ignores fog, so in fog / rain / dust we lay a sphere of the
  // fog colour over it. Vertex alpha makes it densest at the horizon, thinner overhead.
  const hazeGeo = new THREE.SphereGeometry(3500, 32, 16);
  const hp = hazeGeo.attributes.position, ha = new Float32Array(hp.count * 4);
  for (let i = 0; i < hp.count; i++) { const up = Math.max(0, hp.getY(i) / 3500); ha.set([1, 1, 1, 1 - 0.55 * Math.pow(up, 0.6)], i * 4); }
  hazeGeo.setAttribute('color', new THREE.BufferAttribute(ha, 4));
  const haze = new THREE.Mesh(hazeGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false, fog: false }));
  haze.renderOrder = 1; bg.add(haze);

  // background lights (for the distant skyline / mountains)
  const bgHemi = new THREE.HemisphereLight('#b8c6d6', '#3a3129', 0.5); bg.add(bgHemi);
  const bgSun = new THREE.DirectionalLight('#fff2dc', 1); bg.add(bgSun);
  bg.fog = new THREE.FogExp2('#8f9aa0', 0.0011);

  // ---------------- city lights ----------------
  const hemi = new THREE.HemisphereLight('#b8c6d6', '#3a3129', 0.6);
  scene.add(hemi);
  scene.fog = new THREE.FogExp2('#8f9aa0', 0.006);

  let csm = null, plainSun = null, moon = null;
  const lit = new Set();                 // every lit material in the city, for CSM set-up

  /** (Re)create the sun: CSM when shadows are on, a plain light when off. */
  function buildSun(p) {
    if (csm) { csm.remove(); csm.dispose(); csm = null; }
    if (plainSun) { scene.remove(plainSun, plainSun.target); plainSun = null; }
    if (moon) scene.remove(moon, moon.target);
    if (p.shadows) {
      csm = new CSM({ camera, parent: scene, cascades: p.cascades, maxFar: p.shadowDist, mode: 'practical',
        shadowMapSize: p.shadowMap, lightDirection: new THREE.Vector3(-1, -1, -0.3).normalize(), lightIntensity: 2.6, lightNear: 1, lightFar: 900, lightMargin: 120 });
      csm.fade = true;
      for (const l of csm.lights) { l.shadow.normalBias = 0.04; l.shadow.bias = -0.0002; }
      for (const m of lit) setupCsm(m);
    } else {
      plainSun = new THREE.DirectionalLight('#fff2dc', 2.6); scene.add(plainSun, plainSun.target);
      for (const m of lit) {
        if (m.defines) { delete m.defines.USE_CSM; delete m.defines.CSM_CASCADES; delete m.defines.CSM_FADE; }
        if (m.userData.ownCompile !== undefined) { m.onBeforeCompile = m.userData.ownCompile || THREE.Material.prototype.onBeforeCompile; }
        m.needsUpdate = true;
      }
    }
    // The moon MUST be added after the CSM lights: the CSM shader treats the first N directional lights as cascades.
    moon = moon || new THREE.DirectionalLight('#8fa8ff', 0);
    scene.add(moon, moon.target);
  }

  /**
   * CSM installs its own onBeforeCompile on each material. Several of our materials
   * already have one (window grids, wind, water), so we CHAIN them: ours runs, then CSM's.
   */
  function setupCsm(m) {
    if (m.userData.ownCompile === undefined) m.userData.ownCompile = m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ? m.onBeforeCompile : null;
    const own = m.userData.ownCompile;
    csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => { if (own) own(sh, r); csmHook(sh, r); };
    m.customProgramCacheKey = () => (own ? own.toString() : 'plain') + '|csm';   // different patches -> different programs
    m.needsUpdate = true;
  }

  /** Call once after the city, props and player exist (and for anything added later). */
  function registerMaterials(root) {
    root.traverse(o => {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (LIT(m) && !lit.has(m)) { lit.add(m); if (csm) setupCsm(m); }
    });
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(1000); envScene.add(envSky);
  let envRT = null, envTimer = 0, lastEnvClock = -999, lastFov = 0;
  const state = { preset, sunDir: new THREE.Vector3(), daylight: 1, golden: 0 };

  function setPreset(p) {
    state.preset = p;
    buildSun(p);
    lastFov = 0;
  }
  buildSun(preset);

  const tmp = new THREE.Color(), tmp2 = new THREE.Color();
  /**
   * clock: minutes since midnight. focus: player feet (metres).
   * weather: { overcast 0..1, fogMul, tint Color|null, tintAmt }
   */
  function update(clock, focus, dt, weather) {
    const h = clock / 60;
    const theta = (h - 6) / 12 * Math.PI;                  // 0 at sunrise, PI at sunset
    const elev = Math.sin(theta);
    const dir = state.sunDir.set(Math.cos(theta), Math.max(elev, -0.3) * 0.95, 0.35).normalize();
    const day = smooth(-0.08, 0.25, elev), golden = smooth(0.35, 0.02, elev) * day;
    const oc = weather.overcast;                             // clouds / rain / dust block the sun
    state.daylight = day * (1 - oc * 0.35); state.golden = golden;

    // sky gets dustier / greyer when overcast
    U.turbidity.value = 9 + oc * 11; U.rayleigh.value = 2.2 - oc * 1.6;
    U.sunPosition.value.copy(dir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = U[k].value;
    envSky.material.uniforms.sunPosition.value.copy(dir);
    sky.position.copy(camera.position); stars.position.copy(camera.position);
    starMat.opacity = Math.pow(1 - day, 3) * 0.7 * (1 - oc);           // stars only once it's properly dark
    const mdir = new THREE.Vector3(-dir.x, Math.abs(dir.y) * 0.8 + 0.35, -dir.z).normalize();
    moonSprite.position.copy(camera.position).addScaledVector(mdir, 2600); moonSprite.material.opacity = (1 - day) * (1 - oc * 0.8);

    // sun: every cascade shares direction / colour / intensity
    const sunI = 2.6 * day * (1 - 0.75 * oc);
    const sunCol = tmp.setRGB(1, 0.93 - 0.3 * golden, 0.85 - 0.45 * golden);
    if (weather.tint) sunCol.lerp(weather.tint, weather.tintAmt * 0.6);
    if (csm) {
      csm.lightDirection.copy(dir).negate();
      for (const l of csm.lights) { l.intensity = sunI; l.color.copy(sunCol); }
      if (Math.abs(camera.fov - lastFov) > 0.5) { lastFov = camera.fov; csm.updateFrustums(); }   // cascades follow aim / sprint FOV
      csm.update();
    } else {
      plainSun.intensity = sunI; plainSun.color.copy(sunCol);
      plainSun.position.copy(focus).addScaledVector(dir, 100); plainSun.target.position.copy(focus);
    }
    bgSun.intensity = sunI * 0.8; bgSun.color.copy(sunCol); bgSun.position.copy(dir).multiplyScalar(100);
    moon.intensity = 1.5 * (1 - day) * (1 - oc * 0.5);            // bright moonlight: the city stays readable at night
    moon.position.copy(focus).addScaledVector(mdir, 100); moon.target.position.copy(focus);

    hemi.intensity = 0.65 + 0.3 * day; bgHemi.intensity = hemi.intensity * 0.9;   // strong ambient floor at night
    hemi.color.setRGB(0.6 + 0.15 * day, 0.68 + 0.12 * day, 0.85); hemi.groundColor.setRGB(0.3 - 0.07 * day, 0.26 - 0.05 * day, 0.24 - 0.08 * day);
    // night gets a little more exposure (like eyes adapting) so streets stay readable
    renderer.toneMappingExposure = 0.55 + (1 - day) * 0.47 + oc * 0.08;

    // fog colour: haze by day, orange at sunset, deep blue at night, then the weather tint
    const fog = scene.fog.color;
    fog.setRGB(0.56, 0.6, 0.63).lerp(tmp2.setRGB(0.78, 0.55, 0.4), golden * 0.8).lerp(tmp2.setRGB(0.07, 0.1, 0.16), 1 - day);
    if (weather.tint) fog.lerp(tmp2.copy(weather.tint).multiplyScalar(0.25 + 0.75 * day), weather.tintAmt);
    scene.fog.density = (2.4 / state.preset.viewDist) * weather.fogMul * (1 - 0.35 * (1 - day));   // thinner fog at night so you can see further
    bg.fog.color.copy(fog); bg.fog.density = 0.0011 * (1 + (weather.fogMul - 1) * 1.5);
    // the sky is HDR (several times brighter than 1.0), so the haze must be too, or it gets swamped after tone mapping
    haze.position.copy(camera.position); haze.material.color.copy(fog).multiplyScalar(1 + 3.2 * day);
    haze.material.opacity = Math.min(0.94, (weather.fogMul - 1) / 3);

    envTimer -= dt;
    if (envTimer <= 0 || Math.abs(clock - lastEnvClock) > 30) {
      envTimer = 8; lastEnvClock = clock;
      const old = envRT; envRT = pmrem.fromScene(envScene); scene.environment = envRT.texture; bg.environment = envRT.texture;
      scene.environmentIntensity = (0.16 + 0.12 * day) * (1 - oc * 0.4);
      if (old) old.dispose();
    }
  }
  return { update, setPreset, registerMaterials, state, get csm() { return csm; } };
}

/* =====================================================================
   WEATHER  (Phase 3)  - clear, rain, fog, dust storm
   The same weather states as the 2D game. Each state is a blend weight
   (0..1) that eases in and out, so changes are gradual.

   Rain   : GPU rain streaks + ground splashes (both "world-anchored":
            positions wrap around the camera with mod(), so they don't slide
            when you walk), wet darker streets with puddles (see wetU),
            drops running down the camera lens, darker sky
   Fog    : thick fog + drifting ground-mist sheets + light shafts
   Dust   : orange haze, horizontal flying grit, low visibility
            (always possible once the river has died, as in the 2D game)
   Also   : golden-hour light shafts through the air (sun-aligned beams)
   ===================================================================== */
import * as THREE from 'three';
import { canvasTex } from './kit.js';

export const wetU = { value: 0 };               // 0 dry .. 1 soaked (read by ground & facade shaders)
export const TYPES = ['clear', 'rain', 'fog', 'dust'];

export function createWeather(scene, preset, renderer) {
  // fakeShafts: beam meshes used only when real (post-processed) god rays are off
  const w = { type: 'clear', blend: { clear: 1, rain: 0, fog: 0, dust: 0 }, timer: 100, forced: false, riverDead: false, fakeShafts: true };
  const timeU = { value: 0 }, camU = { value: new THREE.Vector3() }, windU = { value: new THREE.Vector2(2.5, 0.8) };
  // pixels per metre at 1 m distance: point sprites are sized in real metres, not screen pixels
  const scaleU = { value: 500 }, _buf = new THREE.Vector2();

  // ---------------- rain streaks (one line segment per drop) ----------------
  const N = preset.rain, BOX = 44, H = 26;
  const rp = new Float32Array(N * 6), rs = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    const x = Math.random() * BOX, y = Math.random() * H, z = Math.random() * BOX;
    rp.set([x, y, z, x, y, z], i * 6); rs[i * 2] = 0; rs[i * 2 + 1] = 1;   // 0 = head, 1 = tail vertex
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rainGeo.setAttribute('aTail', new THREE.BufferAttribute(rs, 1));
  const rainU = { uTime: timeU, uCam: camU, uWind: windU, uAmt: { value: 0 }, uColor: { value: new THREE.Color('#b8c4cc') } };
  const rain = new THREE.LineSegments(rainGeo, new THREE.ShaderMaterial({
    uniforms: rainU, transparent: true, depthWrite: false,
    vertexShader: `
      uniform float uTime; uniform vec3 uCam; uniform vec2 uWind; attribute float aTail; varying float vA;
      void main() {
        vec3 p = position;
        p.y = mod(p.y - uTime * 17.0, ${H.toFixed(1)});                         // fall and wrap
        vec2 xz = p.xz + uWind * (p.y / 17.0);                                   // slant with the wind
        xz = mod(xz - uCam.xz, ${BOX.toFixed(1)}) + uCam.xz - ${(BOX / 2).toFixed(1)};  // anchored to the world
        vec3 wp = vec3(xz.x, uCam.y - 6.0 + p.y, xz.y);
        wp += aTail * vec3(uWind.x * 0.035, 0.6, uWind.y * 0.035);               // streak length
        vA = 1.0 - aTail * 0.8;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `uniform float uAmt; uniform vec3 uColor; varying float vA; void main() { gl_FragColor = vec4(uColor, 0.35 * vA * uAmt); }`,
  }));
  rain.frustumCulled = false; scene.add(rain);

  // ---------------- splashes: expanding rings on the ground ----------------
  const NS = Math.floor(preset.rain / 4), sp = new Float32Array(NS * 3);
  for (let i = 0; i < NS; i++) sp.set([Math.random() * 30, Math.random(), Math.random() * 30], i * 3);   // y = phase seed
  const splGeo = new THREE.BufferGeometry(); splGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  const splU = { uTime: timeU, uCam: camU, uAmt: { value: 0 }, uScale: scaleU };
  const splash = new THREE.Points(splGeo, new THREE.ShaderMaterial({
    uniforms: splU, transparent: true, depthWrite: false,
    vertexShader: `
      uniform float uTime; uniform vec3 uCam; uniform float uScale; varying float vPh;
      void main() {
        vPh = fract(uTime * 1.6 + position.y * 7.0);
        vec2 xz = mod(position.xz + floor(uTime * 1.6 + position.y * 7.0) * 3.7 - uCam.xz, 30.0) + uCam.xz - 15.0;   // new spot every cycle
        vec4 mv = viewMatrix * vec4(xz.x, 0.04, xz.y, 1.0);
        gl_PointSize = (0.06 + vPh * 0.3) * uScale / -mv.z;            // ring grows from 6 cm to 36 cm
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uAmt; varying float vPh;
      void main() { float d = length(gl_PointCoord - 0.5) * 2.0; float ring = smoothstep(0.75, 0.9, d) * (1.0 - smoothstep(0.9, 1.0, d));
        gl_FragColor = vec4(0.8, 0.85, 0.9, ring * (1.0 - vPh) * 0.55 * uAmt); }`,
  }));
  splash.frustumCulled = false; scene.add(splash);

  // ---------------- dust storm grit ----------------
  const ND = Math.floor(preset.rain / 2), dp = new Float32Array(ND * 3);
  for (let i = 0; i < ND; i++) dp.set([Math.random() * 60, Math.random() * 14, Math.random() * 60], i * 3);
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
  const dustU = { uTime: timeU, uCam: camU, uWind: windU, uAmt: { value: 0 }, uScale: scaleU };
  const dust = new THREE.Points(dustGeo, new THREE.ShaderMaterial({
    uniforms: dustU, transparent: true, depthWrite: false,
    vertexShader: `
      uniform float uTime; uniform vec3 uCam; uniform vec2 uWind; uniform float uScale;
      void main() {
        vec2 xz = position.xz + uWind * uTime * 6.0 + vec2(sin(uTime + position.y), cos(uTime * 0.7 + position.x)) * 1.5;
        xz = mod(xz - uCam.xz, 60.0) + uCam.xz - 30.0;
        vec4 mv = viewMatrix * vec4(xz.x, position.y + sin(uTime * 2.0 + position.x) * 0.5, xz.y, 1.0);
        gl_PointSize = max(1.5, 0.05 * uScale / -mv.z); gl_Position = projectionMatrix * mv;   // 5 cm grit
      }`,
    fragmentShader: `uniform float uAmt; void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(0.72, 0.52, 0.3, (0.5 - d) * 1.6 * uAmt); }`,
  }));
  dust.frustumCulled = false; scene.add(dust);

  // ---------------- ground mist: drifting noise sheets near the ground ----------------
  const mistTex = canvasTex(256, 256, (g, s) => {
    for (let i = 0; i < 90; i++) { const x = Math.random() * s, y = Math.random() * s, r = 20 + Math.random() * 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) { g.fillStyle = gr; g.save(); g.translate(ox, oy); g.fillRect(x - r, y - r, 2 * r, 2 * r); g.restore(); } }   // tileable
  }, { repeat: true });
  // all sheets stay below camera height (>= 1.1 m), otherwise you see the edge of a sheet as a seam
  const mists = [0.25, 0.6, 0.95].map((y, i) => {
    const t = mistTex.clone(); t.needsUpdate = true; t.repeat.set(3, 3);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: t, color: '#cfd6da', transparent: true, opacity: 0, depthWrite: false }));
    m.position.y = y; m.renderOrder = 2; scene.add(m); return { m, t, speed: 0.004 + i * 0.002 };
  });

  // ---------------- light shafts: sun-aligned beams through hazy air ----------------
  const shaftTex = canvasTex(64, 256, (g, sw, sh) => {
    const gr = g.createLinearGradient(0, 0, 0, sh); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, sw, sh);
    const gx = g.createLinearGradient(0, 0, sw, 0); gx.addColorStop(0, 'rgba(0,0,0,1)'); gx.addColorStop(0.5, 'rgba(0,0,0,0)'); gx.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = gx; g.fillRect(0, 0, sw, sh);
  });
  const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTex, color: '#ffd9a0', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const shafts = Array.from({ length: 10 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shaftMat); m.frustumCulled = false; scene.add(m);
    return { m, ox: (Math.random() - 0.5) * 70, oz: (Math.random() - 0.5) * 70, width: 2 + Math.random() * 5 };
  });

  // ---------------- raindrops on the camera lens (2D overlay canvas) ----------------
  const lens = document.getElementById('lens'), lctx = lens ? lens.getContext('2d') : null;
  const drops = [];

  const info = { overcast: 0, fogMul: 1, tint: new THREE.Color(), tintAmt: 0 };
  const DUST = new THREE.Color(0.8, 0.52, 0.3), FOGC = new THREE.Color(0.62, 0.66, 0.7);
  const _right = new THREE.Vector3(), _norm = new THREE.Vector3(), _m = new THREE.Matrix4();

  w.set = type => { w.type = type; w.timer = 120 + Math.random() * 90; };
  w.cycle = () => { w.forced = true; w.set(TYPES[(TYPES.indexOf(w.type) + 1) % TYPES.length]); };

  w.update = (dt, t, camera, sun) => {
    timeU.value = t; camU.value.copy(camera.position);
    if (renderer) scaleU.value = camera.projectionMatrix.elements[5] * renderer.getDrawingBufferSize(_buf).y / 2;
    windU.value.set(2.5 + Math.sin(t * 0.1) * 1.5, 0.8 + Math.cos(t * 0.13));
    // pick new weather now and then (dust only after the river has died, or rarely)
    w.timer -= dt;
    if (w.timer <= 0 && !w.forced) {
      const pool = w.riverDead ? ['dust', 'dust', 'clear', 'fog'] : ['clear', 'clear', 'rain', 'fog', 'clear'];
      w.set(pool[Math.floor(Math.random() * pool.length)]);
    }
    for (const k of TYPES) w.blend[k] += ((w.type === k ? 1 : 0) - w.blend[k]) * Math.min(1, dt * 0.35);
    const { rain: R, fog: F, dust: Du } = w.blend;

    // puddles fill quickly in rain and dry slowly afterwards
    wetU.value = R > wetU.value ? Math.min(1, wetU.value + dt * 0.12 * R) : Math.max(0, wetU.value - dt * 0.012);

    rainU.uAmt.value = R; rain.visible = R > 0.02;
    splU.uAmt.value = R * wetU.value; splash.visible = R > 0.05;
    dustU.uAmt.value = Du; dust.visible = Du > 0.02;
    for (const [i, s] of mists.entries()) {
      s.m.position.x = camera.position.x; s.m.position.z = camera.position.z;
      s.t.offset.set(s.m.position.x / 260 * 3 + t * s.speed, s.m.position.z / 260 * 3 + t * s.speed * 0.6);   // world-locked + drifting
      s.m.material.opacity = (F * 0.55 + Du * 0.35 + R * 0.12) * (1 - i * 0.2);
      s.m.material.color.copy(Du > F ? DUST : FOGC);
    }
    // shafts: strongest at golden hour and in fog, never at night or in rain
    const shaftAmt = sun.daylight * (sun.golden * 0.7 + F * 0.5 + Du * 0.3) * (1 - R);
    shaftMat.opacity = shaftAmt * 0.16;
    for (const s of shafts) {
      s.m.visible = w.fakeShafts && shaftAmt > 0.02;
      if (!s.m.visible) continue;
      const axis = sun.sunDir, len = 70;
      const base = new THREE.Vector3(camera.position.x + s.ox, 0, camera.position.z + s.oz);
      const c = base.clone().addScaledVector(axis, len * 0.45);
      // face the camera, rotating only around the beam axis
      _norm.subVectors(camera.position, c); _norm.addScaledVector(axis, -_norm.dot(axis)).normalize();
      _right.crossVectors(axis, _norm).normalize();
      _m.makeBasis(_right.multiplyScalar(s.width), axis.clone().multiplyScalar(len), _norm);
      s.m.matrixAutoUpdate = false; s.m.matrix.copy(_m).setPosition(c); s.m.matrixWorldNeedsUpdate = true;
      shaftMat.color.setRGB(1, 0.85 - F * 0.1, 0.62 + F * 0.3);
    }

    // what the lighting module needs
    info.overcast = Math.min(1, R * 0.75 + F * 0.35 + Du * 0.6);
    info.fogMul = 1 + R * 0.8 + F * 2.4 + Du * 3.6;
    info.tintAmt = Math.max(Du * 0.8, F * 0.4);
    info.tint.copy(Du >= F ? DUST : FOGC);

    // lens drops (only while it rains and the camera is outside)
    if (lctx) {
      if (lens.width !== innerWidth) { lens.width = innerWidth; lens.height = innerHeight; }
      if (R > 0.2 && Math.random() < R * dt * 14) drops.push({ x: Math.random() * lens.width, y: Math.random() * lens.height * 0.8, r: 3 + Math.random() * 9, life: 2 + Math.random() * 3, vy: 0 });
      lctx.clearRect(0, 0, lens.width, lens.height);
      for (const d of drops) {
        d.life -= dt; if (d.r > 8) { d.vy += dt * 40; d.y += d.vy * dt; }       // big drops run down
        const a = Math.min(1, d.life) * 0.5;
        const g = lctx.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.3, 0, d.x, d.y, d.r);
        g.addColorStop(0, `rgba(255,255,255,${a * 0.7})`); g.addColorStop(0.6, `rgba(200,215,230,${a * 0.15})`); g.addColorStop(1, `rgba(20,30,40,${a * 0.5})`);
        lctx.fillStyle = g; lctx.beginPath(); lctx.ellipse(d.x, d.y, d.r * 0.85, d.r, 0, 0, 6.2832); lctx.fill();
      }
      for (let i = drops.length - 1; i >= 0; i--) if (drops[i].life <= 0 || drops[i].y > lens.height + 20) drops.splice(i, 1);
    }
    return info;
  };
  return w;
}

/* =====================================================================
   THE LAST SIGNAL - CHARACTER RENDERER  (Phase 1)
   Draws a top-down human procedurally: no image files.

   Every character is a plain CONFIG object:
     { skin, hair, hairColor, top, pattern, jacket, vest, coat, pants,
       acc: [...accessories], body: 'slim'|'normal'|'heavy', height }
   and every frame we pass a POSE STATE:
     { x, y, a (facing, radians), speed (px/s), walk (phase),
       aim (bool), weapon ('none'|'pistol'|'rifle'|'pipe'),
       hit (0..0.3 flash timer), dead (-1 alive, else seconds dead),
       t (time, s), light ({dx, dy, a} shadow from the day clock) }

   Local drawing space: +x = the way the character faces, y = sideways.
   Layer order: shadow, legs/feet, coat tails, arms, torso, backpack,
   hands + weapon, head, hair, accessories, rim light.
   ===================================================================== */
(function (root) {
  'use strict';

  // ---------- colour helpers (cached so we don't parse hex every frame) ----------
  const cache = new Map();
  function rgb(hex) {
    let v = cache.get(hex);
    if (!v) { const n = parseInt(hex.slice(1), 16); v = [n >> 16, n >> 8 & 255, n & 255]; cache.set(hex, v); }
    return v;
  }
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b);
    return `rgb(${x[0] + (y[0] - x[0]) * t | 0},${x[1] + (y[1] - x[1]) * t | 0},${x[2] + (y[2] - x[2]) * t | 0})`;
  }
  const shade = (c, t) => t >= 0 ? mix(c, '#ffffff', t) : mix(c, '#000000', -t);

  // Body types scale shoulder width and torso depth.
  const BODY = { slim: { sh: 0.86, depth: 0.9 }, normal: { sh: 1, depth: 1 }, heavy: { sh: 1.22, depth: 1.2 } };

  // =====================================================================
  // MAIN DRAW
  // =====================================================================
  function draw(ctx, cfg, s) {
    const B = BODY[cfg.body] || BODY.normal;
    const k = cfg.height || 1;
    const hit = Math.max(0, s.hit || 0);
    // Hit reaction: every colour flashes toward white.
    const C = hit > 0 ? c => mix(c, '#ffffff', Math.min(0.85, hit * 4)) : c => c;
    const dead = s.dead == null ? -1 : s.dead;
    const fall = dead >= 0 ? Math.min(1, dead / 0.45) : 0;          // 0..1 fall animation
    const fade = dead > 10 ? Math.max(0, 1 - (dead - 10)) : 1;      // body fades after 10 s
    if (fade <= 0) return;

    ctx.save();
    ctx.globalAlpha *= fade;

    // ---- 1. SHADOW (world space, pushed away from the sun) ----
    const L = s.light || { dx: 3, dy: 3, a: 0.35 };
    // Soft-edged: a small dark core plus a wider, fainter halo.
    const shx = s.x + L.dx * 0.6 * (1 - fall * 0.7), shy = s.y + L.dy * 0.6 * (1 - fall * 0.7);
    ctx.fillStyle = `rgba(0,0,0,${L.a * 0.45})`;
    ctx.beginPath(); ctx.ellipse(shx, shy, (8.5 * B.sh + fall * 4) * k, 6.5 * k, s.a, 0, 6.2832); ctx.fill();
    ctx.fillStyle = `rgba(0,0,0,${L.a * 0.5})`;
    ctx.beginPath(); ctx.ellipse(shx, shy, (6.5 * B.sh + fall * 3) * k, 4.8 * k, s.a, 0, 6.2832); ctx.fill();

    ctx.translate(s.x, s.y);
    ctx.rotate(s.a);
    ctx.scale(k, k);

    // ---- death: the body tips backwards and lies stretched out ----
    if (fall > 0) {
      ctx.translate(-9 * fall, 0);
      ctx.rotate(0.35 * fall * (cfg.seedSide || 1));
      ctx.scale(1 + 0.55 * fall, 1 + 0.1 * fall);
    }
    // stagger backwards when hit
    if (hit > 0) ctx.translate(-hit * 14, 0);

    // ---- animation parameters ----
    const spd = fall > 0 ? 0 : (s.speed || 0);
    const moving = spd > 12;
    const run = spd > 190;
    const amp = moving ? (run ? 7.5 : 4.6) * Math.min(1, spd / 140) : 0;  // stride length
    const sw = Math.sin(s.walk || 0);                                   // -1..1 swing
    const lean = run ? 2.2 : moving ? 0.8 : 0;                          // forward lean
    const breathe = moving || fall ? 1 : 1 + 0.035 * Math.sin((s.t || 0) * 2.3);
    const sh = 7.6 * B.sh * breathe;                                    // shoulder half-width
    const hipY = 3.5 * B.sh;

    // ---- 2. LEGS & FEET ----
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) {
      const fx = fall > 0 ? -6 : sw * amp * side;       // alternating legs
      ctx.strokeStyle = C(cfg.pants); ctx.lineWidth = 3.6 * B.depth;
      ctx.beginPath(); ctx.moveTo(0, side * hipY); ctx.lineTo(fx, side * hipY * (fall ? 1.4 : 1)); ctx.stroke();
      ctx.fillStyle = C(cfg.boots || '#1c1a18');
      ctx.beginPath(); ctx.ellipse(fx + 1.6, side * hipY * (fall ? 1.4 : 1), 2.7, 1.9, 0, 0, 6.2832); ctx.fill();
    }

    // ---- 3. LONG COAT TAILS (lab coat, trench coat) hang behind the body ----
    if (cfg.coat) {
      ctx.fillStyle = C(shade(cfg.coat, -0.08));
      ctx.beginPath(); ctx.ellipse(-3.5 + lean * 0.2, 0, 7.5, sh * 0.95, 0, 0, 6.2832); ctx.fill();
    }

    // ---- 4. ARMS (behind the torso edges) ----
    const sleeve = cfg.coat || (cfg.jacket && !cfg.vest ? cfg.jacket : cfg.top);
    const hands = armPose(s, sw, amp, sh, fall);
    ctx.strokeStyle = C(sleeve); ctx.lineWidth = 3.4 * B.depth;
    for (const h of hands) { ctx.beginPath(); ctx.moveTo(h.sx, h.sy); ctx.lineTo(h.x, h.y); ctx.stroke(); }

    // ---- 5. TORSO ----
    const tx = lean * 0.35, rx = 5.4 * B.depth, ry = sh;
    ctx.fillStyle = C(cfg.jacket || cfg.coat || cfg.top);
    ctx.beginPath(); ctx.ellipse(tx, 0, rx, ry, 0, 0, 6.2832); ctx.fill();
    // shirt visible where the jacket / coat opens at the front
    if (cfg.jacket || cfg.coat) {
      ctx.fillStyle = C(cfg.top);
      ctx.beginPath(); ctx.ellipse(tx + rx * 0.55, 0, rx * 0.5, ry * 0.3, 0, 0, 6.2832); ctx.fill();
    }
    // fabric pattern, clipped to the torso shape
    if (cfg.pattern && cfg.pattern !== 'plain') {
      ctx.save(); ctx.beginPath(); ctx.ellipse(tx, 0, rx, ry, 0, 0, 6.2832); ctx.clip();
      ctx.strokeStyle = 'rgba(0,0,0,.22)'; ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 1;
      if (cfg.pattern === 'stripes') for (let y = -ry; y < ry; y += 2.6) { ctx.beginPath(); ctx.moveTo(-rx, y); ctx.lineTo(rx, y); ctx.stroke(); }
      if (cfg.pattern === 'check') { for (let y = -ry; y < ry; y += 3) { ctx.beginPath(); ctx.moveTo(-rx, y); ctx.lineTo(rx, y); ctx.stroke(); } for (let x = -rx; x < rx; x += 3) { ctx.beginPath(); ctx.moveTo(x, -ry); ctx.lineTo(x, ry); ctx.stroke(); } }
      if (cfg.pattern === 'camo') for (const [px, py, pr] of [[-2, -4, 2], [2, 3, 1.8], [-1, 5, 1.5], [3, -2, 1.4], [-3, 1, 1.6]]) { ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.2832); ctx.fill(); }
      ctx.restore();
    }
    // a subtle top-light so the torso reads as round
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.ellipse(tx + 1, -ry * 0.25, rx * 0.6, ry * 0.45, 0, 0, 6.2832); ctx.fill();
    // vest panels over a shirt
    if (cfg.vest) {
      ctx.fillStyle = C(cfg.vest);
      ctx.beginPath(); ctx.ellipse(tx - 0.5, -ry * 0.5, rx * 0.95, ry * 0.45, 0, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(tx - 0.5, ry * 0.5, rx * 0.95, ry * 0.45, 0, 0, 6.2832); ctx.fill();
    }
    torsoAccessories(ctx, cfg, C, tx, rx, ry);

    // ---- 6. HANDS & WEAPON ----
    drawWeapon(ctx, s, hands, fall);
    ctx.fillStyle = C(cfg.skin);
    for (const h of hands) { ctx.beginPath(); ctx.arc(h.x, h.y, 1.9, 0, 6.2832); ctx.fill(); }
    if (cfg.acc && cfg.acc.includes('rings')) { ctx.fillStyle = '#e8c65a'; for (const h of hands) { ctx.beginPath(); ctx.arc(h.x + 0.6, h.y, 0.8, 0, 6.2832); ctx.fill(); } }

    // ---- 7. HEAD, HAIR, HEAD ACCESSORIES ----
    const hx = 1.2 + lean, hr = 4.3;
    ctx.fillStyle = C(cfg.skin);
    ctx.beginPath(); ctx.arc(hx, 0, hr, 0, 6.2832); ctx.fill();
    drawHair(ctx, cfg, C, hx, hr);
    headAccessories(ctx, cfg, C, hx, hr);

    // ---- 8. RIM LIGHT: a thin warm outline so people pop off the dark ground ----
    ctx.strokeStyle = s.rim || 'rgba(255,226,180,.32)'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.ellipse(tx, 0, rx + 0.4, ry + 0.4, 0, -1.3, 1.3); ctx.stroke();
    ctx.beginPath(); ctx.arc(hx, 0, hr + 0.4, -1.2, 1.2); ctx.stroke();

    ctx.restore();
  }

  /** Where the hands go, depending on walk / aim / weapon / death. */
  function armPose(s, sw, amp, sh, fall) {
    const S = [{ sx: 0.5, sy: -sh * 0.92 }, { sx: 0.5, sy: sh * 0.92 }];   // shoulders (left, right)
    if (fall > 0) return [{ ...S[0], x: -2, y: -sh - 6 }, { ...S[1], x: 3, y: sh + 6 }];  // arms flung out
    const w = s.weapon || 'none';
    if (s.aim && (w === 'pistol')) return [{ ...S[0], x: 11.5, y: -0.6 }, { ...S[1], x: 12.5, y: 0.8 }];
    if (s.aim && (w === 'rifle')) return [{ ...S[0], x: 13, y: -0.6 }, { ...S[1], x: 6, y: 2.2 }];
    if (w === 'pipe') {
      const swing = s.swing || 0;                          // melee swing arc 0..1
      return [{ ...S[0], x: 3 - sw * amp * 0.7, y: -sh - 1.5 }, { ...S[1], x: 6 + 6 * Math.sin(swing * 3.14), y: sh + 1.5 - swing * 8 }];
    }
    // relaxed walk: arms swing opposite to the legs
    return [{ ...S[0], x: 0.5 - sw * amp * 0.9, y: -sh - 1.5 }, { ...S[1], x: 0.5 + sw * amp * 0.9, y: sh + 1.5 }];
  }

  function drawWeapon(ctx, s, hands, fall) {
    const w = s.weapon || 'none';
    if (w === 'none' || fall > 0) return;
    const r = hands[1];
    ctx.save();
    if (w === 'pistol') {
      const x = s.aim ? 12 : r.x, y = s.aim ? 0.1 : r.y;
      ctx.fillStyle = '#1b1c1e'; ctx.fillRect(x, y - 1.1, 5.5, 2.2);
      ctx.fillStyle = '#4a4d52'; ctx.fillRect(x + 1, y - 0.6, 4, 0.6);
    } else if (w === 'rifle') {
      if (s.aim) { ctx.fillStyle = '#1b1c1e'; ctx.fillRect(3, -0.2, 18, 2.4); ctx.fillStyle = '#5a4630'; ctx.fillRect(2, 0, 5, 2.8); ctx.fillStyle = '#2e3033'; ctx.fillRect(12, 2, 2.4, 3); }
      else { ctx.translate(r.x, r.y); ctx.rotate(-0.9); ctx.fillStyle = '#1b1c1e'; ctx.fillRect(-4, -1, 15, 2.2); ctx.fillStyle = '#5a4630'; ctx.fillRect(-6, -1.2, 5, 2.6); }
    } else if (w === 'pipe') {
      ctx.translate(r.x, r.y); ctx.rotate(-0.5 + (s.swing || 0) * 1.8);
      ctx.strokeStyle = '#7d8083'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(13, 0); ctx.stroke();
      ctx.strokeStyle = '#5c3a28'; ctx.lineWidth = 2.6; ctx.beginPath(); ctx.moveTo(-1, 0); ctx.lineTo(2, 0); ctx.stroke();
    } else if (w === 'molotov') {
      ctx.fillStyle = '#3e6b3a'; ctx.beginPath(); ctx.arc(r.x + 2, r.y, 2.2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#f2a93b'; ctx.beginPath(); ctx.arc(r.x + 4, r.y, 1.2 + Math.random() * 0.6, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }

  function torsoAccessories(ctx, cfg, C, tx, rx, ry) {
    const acc = cfg.acc || [];
    if (acc.includes('backpack')) { ctx.fillStyle = C(cfg.packColor || '#4a4234'); roundRect(ctx, tx - rx - 3, -ry * 0.6, 5, ry * 1.2, 1.5); ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(tx - rx - 2, -1, 3, 2); }
    if (acc.includes('radio')) { ctx.fillStyle = '#222'; ctx.fillRect(tx + rx * 0.35, -ry * 0.55, 2.4, 3); ctx.fillStyle = '#e04030'; ctx.fillRect(tx + rx * 0.35 + 0.5, -ry * 0.55 + 0.3, 0.9, 0.9); }
    if (acc.includes('waistTie')) { ctx.strokeStyle = C(cfg.pants); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(tx - 1, 0, rx * 0.8, ry * 0.85, 0, 1.9, 4.4); ctx.stroke(); }
    if (acc.includes('toolbelt')) { ctx.strokeStyle = '#6b4a2a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(tx, 0, rx * 0.9, ry * 0.95, 0, 2, 4.3); ctx.stroke(); ctx.fillStyle = '#9aa0a6'; ctx.fillRect(tx - rx, ry * 0.6, 2, 2); ctx.fillRect(tx - rx, -ry * 0.75, 2, 2); }
    if (acc.includes('shawl')) { ctx.fillStyle = C(cfg.shawl || '#8a6a3e'); ctx.beginPath(); ctx.ellipse(tx - 0.5, 0, rx * 0.95, ry * 1.08, 0, 0, 6.2832); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 0.7; for (let y = -ry; y < ry; y += 2.2) { ctx.beginPath(); ctx.moveTo(tx - rx * 0.6, y); ctx.lineTo(tx - rx * 0.9, y + 1); ctx.stroke(); } }
    if (acc.includes('spikes')) { ctx.fillStyle = C('#3a3a3a'); for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(0, side * ry * 0.85, 3.4, 2.6, 0, 0, 6.2832); ctx.fill(); ctx.fillStyle = C('#b9bcbf'); for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(i * 2 - 0.8, side * ry * 0.95); ctx.lineTo(i * 2, side * (ry + 3.2)); ctx.lineTo(i * 2 + 0.8, side * ry * 0.95); ctx.fill(); } ctx.fillStyle = C('#3a3a3a'); } }
    if (acc.includes('armband')) { ctx.fillStyle = '#f2f2f2'; ctx.fillRect(-1, ry - 1.5, 3, 2.5); ctx.fillStyle = '#c62f2f'; ctx.fillRect(0.1, ry - 1.3, 0.8, 2.1); ctx.fillRect(-0.5, ry - 0.6, 2, 0.7); }
    if (acc.includes('armor')) { ctx.fillStyle = C('#e9eef0'); ctx.beginPath(); ctx.ellipse(tx + 0.5, 0, rx * 0.8, ry * 0.8, 0, 0, 6.2832); ctx.fill(); ctx.fillStyle = C('#2fb3a6'); ctx.fillRect(tx + rx * 0.2, -ry * 0.6, 1.2, ry * 1.2); }
    if (acc.includes('tie')) { ctx.fillStyle = '#20262c'; ctx.fillRect(tx + rx * 0.5, -0.6, rx * 0.5, 1.2); }
  }

  function drawHair(ctx, cfg, C, hx, hr) {
    const col = C(cfg.hairColor || '#1a1512'), st = cfg.hair || 'short';
    ctx.fillStyle = col;
    switch (st) {
      case 'bald':
        ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.beginPath(); ctx.arc(hx - 0.8, -1, 1.8, 0, 6.2832); ctx.fill(); break;
      case 'buzz':
        ctx.globalAlpha *= 0.65; ctx.beginPath(); ctx.arc(hx - 0.7, 0, hr * 0.95, 0, 6.2832); ctx.fill(); ctx.globalAlpha /= 0.65; break;
      case 'short':
        ctx.beginPath(); ctx.arc(hx - 0.8, 0, hr * 1.02, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.arc(hx - 1.3, -1.2, 1.6, 0, 6.2832); ctx.fill(); break;
      case 'long':
        ctx.beginPath(); ctx.ellipse(hx - 2.2, 0, hr + 1.8, hr + 0.8, 0, 0, 6.2832); ctx.fill(); break;
      case 'bun':
        ctx.beginPath(); ctx.arc(hx - 0.8, 0, hr, 0, 6.2832); ctx.fill(); ctx.beginPath(); ctx.arc(hx - hr - 1, 0, 2.2, 0, 6.2832); ctx.fill(); break;
      case 'curly':
        for (let i = 0; i < 9; i++) { const a = i / 9 * 6.2832; ctx.beginPath(); ctx.arc(hx - 1 + Math.cos(a) * 3.2, Math.sin(a) * 3.4, 2.1, 0, 6.2832); ctx.fill(); }
        ctx.beginPath(); ctx.arc(hx - 1, 0, 3, 0, 6.2832); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.2)'; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(hx - 2 + i, -2 + (i % 2) * 3, 0.8, 0, 6.2832); ctx.fill(); } break;
      case 'slick':
        ctx.beginPath(); ctx.arc(hx - 0.9, 0, hr * 1.02, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 0.6;
        for (const y of [-2, 0, 2]) { ctx.beginPath(); ctx.moveTo(hx + 2.4, y); ctx.lineTo(hx - 4, y * 1.2); ctx.stroke(); } break;
      case 'braid': // shaved sides + top strip + braid down the back (Rhea)
        ctx.fillStyle = C(shade(cfg.skin, -0.18)); ctx.beginPath(); ctx.arc(hx - 0.6, 0, hr * 0.98, 0, 6.2832); ctx.fill();
        ctx.fillStyle = col; roundRect(ctx, hx - hr - 0.5, -1.6, hr * 2, 3.2, 1.4);
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(hx - hr - 1.8 - i * 2.2, 0, 1.4, 1.1, 0, 0, 6.2832); ctx.fill(); } break;
      case 'mohawk':
        ctx.fillStyle = C(shade(cfg.skin, -0.15)); ctx.beginPath(); ctx.arc(hx - 0.5, 0, hr * 0.97, 0, 6.2832); ctx.fill();
        ctx.fillStyle = col;
        for (let i = 0; i < 5; i++) { const x = hx + 3 - i * 1.9; ctx.beginPath(); ctx.moveTo(x - 1, -1.1); ctx.lineTo(x + 1.6, 0); ctx.lineTo(x - 1, 1.1); ctx.fill(); }
        break;
    }
  }

  function headAccessories(ctx, cfg, C, hx, hr) {
    const acc = cfg.acc || [];
    if (acc.includes('beard')) { ctx.fillStyle = C(cfg.beardColor || '#e8e4dc'); ctx.beginPath(); ctx.ellipse(hx + hr * 0.75, 0, 2.6, 3.2, 0, 0, 6.2832); ctx.fill(); }
    if (acc.includes('cap')) {
      ctx.fillStyle = C(cfg.capColor || '#3c4a5a');
      ctx.beginPath(); ctx.arc(hx - 0.4, 0, hr * 1.02, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(hx + hr * 0.95, 0, 2.6, 3.4, 0, -1.57, 1.57); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.beginPath(); ctx.arc(hx - 1, -1, 1.5, 0, 6.2832); ctx.fill();
    }
    if (acc.includes('helmet')) {
      ctx.fillStyle = C('#e7ecee'); ctx.beginPath(); ctx.arc(hx - 0.3, 0, hr * 1.12, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#2fb3a6'; ctx.beginPath(); ctx.ellipse(hx + hr * 0.75, 0, 1.4, 3.3, 0, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(hx - hr, 0); ctx.lineTo(hx + hr * 0.4, 0); ctx.stroke();
    }
    if (acc.includes('bandana')) { ctx.strokeStyle = C(cfg.bandColor || '#9b2b2b'); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(hx, 0, hr * 0.92, 0, 6.2832); ctx.stroke(); ctx.fillStyle = C(cfg.bandColor || '#9b2b2b'); ctx.beginPath(); ctx.moveTo(hx - hr, 0); ctx.lineTo(hx - hr - 3, -1.5); ctx.lineTo(hx - hr - 2.5, 1.8); ctx.fill(); }
    if (acc.includes('mask')) { ctx.fillStyle = C('#d8d2c4'); ctx.beginPath(); ctx.arc(hx + 0.8, 0, hr * 0.9, -1.2, 1.2); ctx.fill(); ctx.strokeStyle = '#c43d2a'; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(hx + 2.2, -2.4); ctx.lineTo(hx + 4, 2.2); ctx.stroke(); }
    if (acc.includes('gasmask')) { ctx.fillStyle = C('#2c3032'); ctx.beginPath(); ctx.arc(hx + hr * 0.7, 0, 2.2, 0, 6.2832); ctx.fill(); ctx.fillStyle = C('#5a6064'); ctx.beginPath(); ctx.arc(hx + hr * 0.7 + 1.6, 0, 1.3, 0, 6.2832); ctx.fill(); }
    if (acc.includes('glasses')) { ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 0.6; ctx.fillStyle = 'rgba(170,210,230,.45)'; for (const y of [-1.7, 1.7]) { ctx.beginPath(); ctx.arc(hx + hr * 0.82, y, 1.1, 0, 6.2832); ctx.fill(); ctx.stroke(); } }
    if (acc.includes('goggles')) { ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hx - 0.3, 0, hr * 0.95, 0, 6.2832); ctx.stroke(); ctx.fillStyle = '#6fb8d6'; for (const y of [-1.8, 1.8]) { ctx.beginPath(); ctx.arc(hx + 1.2, y, 1.4, 0, 6.2832); ctx.fill(); } }
    if (acc.includes('headphones')) { ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx - 0.3, -hr); ctx.lineTo(hx - 0.3, hr); ctx.stroke(); /* band over the head */ ctx.fillStyle = '#1e1e1e'; for (const y of [-hr - 0.4, hr + 0.4]) { ctx.beginPath(); ctx.ellipse(hx - 0.3, y, 1.8, 1.2, 0, 0, 6.2832); ctx.fill(); } }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
  }

  // =====================================================================
  // CONFIGS: random survivors, enemies, guards, main cast
  // =====================================================================
  const SKIN = ['#f1c9a5', '#e0ac85', '#c99a78', '#b98a67', '#a26f4f', '#8d5c3e', '#6e4530', '#553424'];
  const HAIR_COL = ['#15120f', '#2b1d14', '#4a2f1d', '#6d4a2c', '#8a8580', '#b89a6a', '#1f1f28', '#5a2a1a'];
  const TOPS = ['#5a6b6f', '#6b5a48', '#48594a', '#735050', '#4d4d63', '#7a6a4a', '#3f5566', '#6a6f5a', '#8a7058', '#5d4b5e'];
  const PANTS = ['#2b2d2c', '#3a3a44', '#40382c', '#2e3a44', '#4a4638', '#262b30'];
  const pickR = (r, a) => a[Math.floor(r() * a.length)];

  /** A random ordinary survivor. Pass a seeded rng for repeatable looks. */
  function randomSurvivor(r = Math.random) {
    const acc = [];
    for (const a of ['cap', 'bandana', 'glasses', 'backpack', 'gasmask']) if (r() < 0.18) acc.push(a);
    if (acc.includes('cap') && acc.includes('bandana')) acc.splice(acc.indexOf('bandana'), 1);
    const jacket = r() < 0.4 ? shade(pickR(r, TOPS), -0.25) : null;
    return {
      skin: pickR(r, SKIN), hair: pickR(r, ['short', 'short', 'buzz', 'long', 'bun', 'curly', 'bald']), hairColor: pickR(r, HAIR_COL),
      top: pickR(r, TOPS), pattern: pickR(r, ['plain', 'plain', 'stripes', 'check', 'camo']), jacket,
      vest: !jacket && r() < 0.15 ? '#4a4234' : null, pants: pickR(r, PANTS), acc,
      capColor: pickR(r, ['#3c4a5a', '#6a3a2a', '#4a5a3a', '#7a6a4a']), bandColor: pickR(r, ['#9b2b2b', '#2b4b7b', '#3b5b2b']),
      packColor: pickR(r, ['#4a4234', '#3a4a3a', '#5a3a2a']),
      body: pickR(r, ['slim', 'normal', 'normal', 'heavy']), height: 0.92 + r() * 0.16, seedSide: r() < 0.5 ? -1 : 1,
    };
  }

  const CAST = {
    veer: { outfit: 'Casual2', name: 'Veer Malhotra', skin: '#c3926f', hair: 'slick', hairColor: '#2a2019', top: '#d9dde0', pants: '#2c2f38', acc: ['radio', 'stubble', 'watch'], rolled: true, body: 'normal', height: 1.04 },
    rhea: { outfit: 'Punk', female: true, name: 'Rhea "Iron" Dutta', skin: '#a26f4f', hair: 'braid', hairColor: '#1e1712', top: '#55534d', pants: '#d0692a', acc: ['waistTie'], body: 'normal', height: 1.1 },
    elena: { outfit: 'Casual', female: true, name: 'Dr. Elena Cruz', skin: '#c99a78', hair: 'curly', hairColor: '#7c756e', top: '#7a4b4b', coat: '#e8e6e0', pants: '#3a3a44', acc: ['glasses'], body: 'slim', height: 0.97 },
    silas: { outfit: 'Suit', name: 'Silas Crow', skin: '#d2a988', hair: 'slick', hairColor: '#221a14', top: '#2a2a2a', coat: '#6e1f2b', pants: '#1d1d22', acc: ['rings'], body: 'slim', height: 1.04 },
    kane: { outfit: 'Suit', name: 'Director Kane', skin: '#e0c0a8', hair: 'slick', hairColor: '#e4e4e4', top: '#e9e9e9', jacket: '#5d6168', pants: '#4d5157', acc: ['tie'], body: 'normal', height: 1.05 },
    tara: { outfit: 'Adventurer', female: true, name: 'Tara "Sparks" Nair', skin: '#8d5c3e', hair: 'short', hairColor: '#2d7fd6', top: '#2e3a44', vest: '#8a5a2c', pants: '#3a3a44', acc: ['goggles', 'toolbelt'], body: 'slim', height: 0.95 },
    jogi: { outfit: 'Farmer', name: 'Baba Jogi', skin: '#a8764f', hair: 'bald', top: '#d8d0bf', pants: '#b8ad96', acc: ['shawl', 'beard', 'headphones'], shawl: '#8a6a3e', body: 'slim', height: 0.93 },
    razor: { outfit: 'Worker', name: 'Razor', skin: '#c99a78', hair: 'mohawk', hairColor: '#c43d2a', top: '#2a2622', jacket: '#3b3029', pants: '#2b2622', acc: ['spikes', 'mask'], body: 'heavy', height: 1.1 },
  };

  /** Enemy and guard looks, lightly randomised per spawn. */
  function enemyConfig(type, colony, r = Math.random) {
    const base = randomSurvivor(r);
    switch (type) {
      case 'scav': return Object.assign(base, { top: pickR(r, ['#5a4a3a', '#4a3a2a', '#6a4a30', '#3a3a30']), jacket: r() < 0.5 ? '#3a2e24' : null, pattern: pickR(r, ['plain', 'camo', 'stripes']), acc: [r() < 0.5 ? 'bandana' : 'mask', ...(r() < 0.3 ? ['backpack'] : [])], bandColor: '#8a2a1a', body: pickR(r, ['slim', 'normal']) });
      case 'brute': return Object.assign(base, { top: '#3a2e24', jacket: '#2a221c', acc: ['gasmask', 'spikes'], body: 'heavy', height: 1.15 });
      case 'trooper': return Object.assign(base, { top: '#dfe5e8', jacket: null, vest: null, pattern: 'plain', pants: '#c9d0d4', acc: ['helmet', 'armor'], body: 'normal', height: 1.04 });
      case 'guard': {
        const U = { ironside: { top: '#d0692a', pants: '#4a3a2a', acc: ['cap'], capColor: '#8a4a1a' }, mercy: { top: '#e9e7e2', pants: '#5a6470', acc: ['armband'] }, crows: { top: '#5a1a24', jacket: '#6e1f2b', pants: '#1d1d22', acc: ['cap'], capColor: '#2a1418' } }[colony] || {};
        return Object.assign(base, { jacket: null, vest: null, pattern: 'plain', acc: [] }, U);
      }
    }
    return base;
  }

  root.CR = { draw, randomSurvivor, enemyConfig, CAST, mix, shade };
})(typeof window !== 'undefined' ? window : globalThis);

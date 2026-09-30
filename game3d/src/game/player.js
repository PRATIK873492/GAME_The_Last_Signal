/* =====================================================================
   PLAYER CONTROLLER
   - Rapier kinematic character controller (capsule): walks up small steps,
     slides along walls, snaps to the ground, can't pass through buildings.
   - WASD moves relative to the CAMERA, Shift sprints, C crouches, Space jumps.
   - A stand-in Veer made from primitives with a procedural walk cycle.
     Phase 5 swaps this mesh for a rigged, animated model; the controller stays.
   ===================================================================== */
import * as THREE from 'three';
import { toMap, toWorld } from '../core/worldLayout.js';

const WALK = 3.2, SPRINT = 6.8, CROUCH = 1.6;       // metres per second
const GRAVITY = -22, JUMP_V = 6.2;
const RADIUS = 0.3, HALF_STAND = 0.55, HALF_CROUCH = 0.25;

export function createPlayer(scene, phys, startMap) {
  const { RAPIER, world } = phys;
  const start = toWorld(startMap.x, startMap.y);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start.x, 2, start.z));
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_STAND, RADIUS), body);
  const kcc = world.createCharacterController(0.02);
  kcc.enableAutostep(0.45, 0.25, true);             // climb kerbs and low steps
  kcc.enableSnapToGround(0.35);
  kcc.setMaxSlopeClimbAngle(50 * Math.PI / 180);
  kcc.setApplyImpulsesToDynamicBodies(true);

  const mesh = buildStandIn();
  scene.add(mesh.root);

  const p = {
    body, collider, mesh: mesh.root,
    vy: 0, grounded: false, crouch: false, sprint: false, speed: 0,
    heading: 0,                                     // direction the body faces (radians)
    phase: 0,                                       // walk-cycle phase
    map: { x: startMap.x, y: startMap.y },          // position in MAP coordinates (for missions/minimap)
    get pos() { return body.translation(); },
    /** Feet position in metres. */
    feet() { const t = body.translation(); return new THREE.Vector3(t.x, t.y - (this.crouch ? HALF_CROUCH : HALF_STAND) - RADIUS, t.z); },
  };

  p.update = function (dt, input, cam) {
    // ---- desired horizontal move, relative to camera yaw ----
    const fwd = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    const wish = new THREE.Vector3();
    if (input.down('KeyW')) wish.add(fwd);
    if (input.down('KeyS')) wish.sub(fwd);
    if (input.down('KeyD')) wish.add(right);
    if (input.down('KeyA')) wish.sub(right);
    if (wish.lengthSq() > 0) wish.normalize();

    // ---- crouch toggle (C). Standing up needs head room. ----
    if (input.pressed.has('KeyC')) {
      if (!this.crouch) setCrouch(true);
      else if (phys.raycast(body.translation(), { x: 0, y: 1, z: 0 }, 1.3, body) === null) setCrouch(false);
    }
    this.sprint = input.down('ShiftLeft') && !this.crouch && !cam.aiming && wish.lengthSq() > 0;
    const target = this.crouch ? CROUCH : this.sprint ? SPRINT : cam.aiming ? WALK * 0.7 : WALK;

    // ---- jump & gravity ----
    if (this.grounded && input.pressed.has('Space') && !this.crouch) { this.vy = JUMP_V; this.grounded = false; }
    this.vy = this.grounded && this.vy < 0 ? -1 : this.vy + GRAVITY * dt;

    // ---- ask Rapier how far we can actually move ----
    const desired = { x: wish.x * target * dt, y: this.vy * dt, z: wish.z * target * dt };
    kcc.computeColliderMovement(collider, desired);
    const mv = kcc.computedMovement();
    const t = body.translation();
    body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    this.grounded = kcc.computedGrounded();
    if (this.grounded && this.vy > 0 && mv.y < desired.y * 0.5) this.vy = 0;   // bumped head
    this.speed = Math.hypot(mv.x, mv.z) / Math.max(dt, 1e-4);

    // fell out of the world (shouldn't happen): put back on the street
    if (t.y < -20) body.setNextKinematicTranslation({ x: t.x, y: 3, z: t.z });

    // ---- facing: toward movement, or camera direction while aiming ----
    const face = cam.aiming ? Math.atan2(fwd.x, fwd.z) : wish.lengthSq() > 0 ? Math.atan2(wish.x, wish.z) : this.heading;
    let d = face - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * Math.min(1, dt * (cam.aiming ? 20 : 10));
  };

  /** Called AFTER world.step(): copy the physics result onto the mesh and map coordinates. */
  p.sync = function (dt, cam) {
    const f = this.feet();
    mesh.root.position.copy(f);
    mesh.root.rotation.y = this.heading;
    this.phase += this.speed * dt * 2.1;
    mesh.animate(this, cam.aiming, dt);
    this.map = toMap(f.x, f.z);
  };

  function setCrouch(on) {
    const t = body.translation(), delta = HALF_STAND - HALF_CROUCH;
    collider.setHalfHeight(on ? HALF_CROUCH : HALF_STAND);
    body.setTranslation({ x: t.x, y: t.y + (on ? -delta : delta), z: t.z }, true);
    p.crouch = on;
  }
  return p;
}

/**
 * Stand-in Veer: olive field jacket, dark cargo pants, short black hair,
 * radio on the chest. Built so limbs pivot at hips and shoulders.
 */
function buildStandIn() {
  const M = (c, r = 0.8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const skin = M('#b98a67', 0.6), jacket = M('#5b6541', 0.85), pants = M('#2b2d2c', 0.9), boots = M('#1c1a18', 0.7), hair = M('#15120f', 0.9), shirt = M('#3b3e36');
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.92; root.add(hips);
  const part = (geo, mat, parent, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

  // legs pivot at the hip
  const legs = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(0.11 * s, 0, 0); hips.add(g);
    part(new THREE.BoxGeometry(0.17, 0.5, 0.19), pants, g, 0, -0.25, 0);
    const shin = new THREE.Group(); shin.position.y = -0.48; g.add(shin);
    part(new THREE.BoxGeometry(0.15, 0.44, 0.17), pants, shin, 0, -0.2, 0);
    part(new THREE.BoxGeometry(0.16, 0.1, 0.28), boots, shin, 0, -0.42, 0.04);
    return { g, shin };
  });
  // torso
  const spine = new THREE.Group(); hips.add(spine);
  part(new THREE.BoxGeometry(0.42, 0.28, 0.24), pants, spine, 0, 0.06, 0);
  const chest = part(new THREE.BoxGeometry(0.48, 0.5, 0.27), jacket, spine, 0, 0.42, 0);
  part(new THREE.BoxGeometry(0.16, 0.44, 0.02), shirt, spine, 0, 0.42, 0.14);       // open jacket shows shirt
  part(new THREE.BoxGeometry(0.06, 0.1, 0.04), M('#222'), spine, 0.14, 0.52, 0.15);  // radio
  // head
  const neck = new THREE.Group(); neck.position.y = 0.72; spine.add(neck);
  part(new THREE.CylinderGeometry(0.05, 0.06, 0.08, 10), skin, neck, 0, 0.02, 0);
  const head = part(new THREE.SphereGeometry(0.115, 20, 16), skin, neck, 0, 0.16, 0.01);
  head.scale.set(0.92, 1.1, 1);
  const hairCap = part(new THREE.SphereGeometry(0.122, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair, neck, 0, 0.18, -0.01);
  hairCap.scale.set(0.95, 1.05, 1.02);
  for (const s of [-1, 1]) part(new THREE.SphereGeometry(0.018, 8, 6), M('#1a1410'), neck, 0.045 * s, 0.18, 0.11);   // eyes
  // arms pivot at the shoulder
  const arms = [-1, 1].map(s => {
    const g = new THREE.Group(); g.position.set(0.3 * s, 0.62, 0); spine.add(g);
    part(new THREE.BoxGeometry(0.13, 0.34, 0.14), jacket, g, 0, -0.16, 0);
    const fore = new THREE.Group(); fore.position.y = -0.33; g.add(fore);
    part(new THREE.BoxGeometry(0.11, 0.3, 0.12), jacket, fore, 0, -0.14, 0);
    part(new THREE.SphereGeometry(0.055, 10, 8), skin, fore, 0, -0.32, 0);
    return { g, fore };
  });
  const gun = part(new THREE.BoxGeometry(0.05, 0.24, 0.11), M('#1b1c1e', 0.4, 0.8), arms[1].fore, 0, -0.42, 0.03);   // barrel runs along the arm
  gun.visible = false;

  let breathe = 0, aimBlend = 0;
  function animate(p, aiming, dt) {
    const moving = p.speed > 0.3;
    const amp = Math.min(0.85, p.speed * 0.13);
    const sw = Math.sin(p.phase);
    breathe += dt * 2.2;
    aimBlend += ((aiming ? 1 : 0) - aimBlend) * Math.min(1, dt * 12);
    const crouchK = p.crouch ? 1 : 0;

    hips.position.y = 0.92 - 0.32 * crouchK + (moving ? Math.abs(Math.cos(p.phase)) * 0.035 * Math.min(1, p.speed / 3) : 0);
    spine.rotation.x = (p.sprint ? 0.22 : moving ? 0.06 : 0) + 0.35 * crouchK;       // lean forward
    legs.forEach((l, i) => {
      const s = i ? -sw : sw;
      l.g.rotation.x = s * amp - 0.9 * crouchK;
      l.shin.rotation.x = Math.max(0, -s) * amp * 1.2 + 1.3 * crouchK;             // knee bends on the back-swing
      if (!p.grounded) { l.g.rotation.x = -0.5; l.shin.rotation.x = 0.9; }         // tuck in the air
    });
    arms.forEach((a, i) => {
      const walkRot = (i ? sw : -sw) * amp * 0.8;
      const aimRot = -Math.PI / 2 + 0.1;                                           // arms straight forward
      a.g.rotation.x = walkRot * (1 - aimBlend) + aimRot * aimBlend;
      // relaxed: arms hang slightly outward; aiming: both hands swing in to meet at the gun
      a.g.rotation.z = (i ? 0.06 : -0.06) * (1 - aimBlend) + (i ? -0.28 : 0.3) * aimBlend;
      a.fore.rotation.x = -0.25 * (1 - aimBlend) * (moving ? 1 : 0.6);
    });
    chest.scale.set(1, 1 + 0.02 * Math.sin(breathe), 1);
    gun.visible = aimBlend > 0.3;
  }
  return { root, animate };
}

/* =====================================================================
   THIRD-PERSON CAMERA
   - Orbits the player with the mouse (yaw / pitch), over the right shoulder
   - Smooth follow (exponential damping) so it never jerks
   - Wall collision: a ray from the player's head to the desired camera spot;
     if a building is in the way, the camera moves in front of it
   - Right mouse: zooms in over the shoulder (aim)
   - Sprint: wider FOV + subtle head bob
   ===================================================================== */
import * as THREE from 'three';

const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));

export function createCamera(preset) {
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, preset.viewDist);
  const cam = {
    camera, yaw: Math.PI * 0.75, pitch: 0.28, aiming: false,
    sensitivity: 0.0022,
    dist: 4.3,                                   // current (smoothed) distance
    pivot: new THREE.Vector3(),                  // smoothed follow point
    ready: false,
  };

  cam.update = function (dt, input, player, phys) {
    // ---- mouse look ----
    const [mx, my] = input.takeLook();
    const sens = this.sensitivity * (this.aiming ? 0.55 : 1);
    this.yaw -= mx * sens;
    this.pitch = THREE.MathUtils.clamp(this.pitch + my * sens, -0.55, 1.15);
    this.aiming = input.aim;

    // ---- smooth follow of the player's head ----
    const feet = player.feet();
    const headH = player.crouch ? 1.15 : 1.6;
    const target = new THREE.Vector3(feet.x, feet.y + headH, feet.z);
    if (!this.ready) { this.pivot.copy(target); this.ready = true; }
    this.pivot.x = damp(this.pivot.x, target.x, 14, dt);
    this.pivot.z = damp(this.pivot.z, target.z, 14, dt);
    this.pivot.y = damp(this.pivot.y, target.y, 8, dt);          // softer vertically (jumps, crouch)

    // head bob while sprinting
    const bob = player.sprint && player.grounded ? Math.sin(player.phase * 2) * 0.045 : 0;

    // ---- desired offset: behind + above + over the right shoulder ----
    const wantDist = this.aiming ? 1.8 : 4.3;
    const shoulder = this.aiming ? 0.62 : 0.5;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const back = new THREE.Vector3(Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), Math.cos(this.yaw) * Math.cos(this.pitch));
    const look = this.pivot.clone().addScaledVector(right, shoulder); look.y += bob;

    // ---- collision: never let the camera go inside a building ----
    let allowed = wantDist;
    const hit = phys.raycast(look, back, wantDist + 0.3, player.body);
    if (hit !== null) allowed = Math.max(0.35, hit - 0.3);
    // move in instantly (no clipping), ease back out slowly (no popping)
    this.dist = allowed < this.dist ? allowed : damp(this.dist, allowed, 4, dt);

    camera.position.copy(look).addScaledVector(back, this.dist);
    camera.lookAt(look);

    // ---- field of view ----
    const fov = this.aiming ? 48 : player.sprint ? 71 : 62;
    camera.fov = damp(camera.fov, fov, 6, dt);
    camera.updateProjectionMatrix();
  };
  cam.setPreset = p => { camera.far = p.viewDist; camera.updateProjectionMatrix(); };
  cam.resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  return cam;
}

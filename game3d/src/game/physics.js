/* =====================================================================
   PHYSICS (Rapier3D, compiled to WebAssembly)
   Static colliders come from the city builder's collider list, which is
   built from the same layout data as the visuals.
   ===================================================================== */
import RAPIER from '@dimforge/rapier3d-compat';

export async function createPhysics(colliderBoxes) {
  await RAPIER.init();                                        // loads the WASM module
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const b of colliderBoxes) {
    const desc = RAPIER.ColliderDesc.cuboid(b.hx, b.hy, b.hz).setTranslation(b.cx, b.cy, b.cz);
    if (b.ry) desc.setRotation({ x: 0, y: Math.sin(b.ry / 2), z: 0, w: Math.cos(b.ry / 2) });   // yaw-rotated props (cars, barriers)
    world.createCollider(desc, fixed);
  }

  /** First hit along a ray, ignoring one rigid body (e.g. the player). Returns distance or null. */
  function raycast(origin, dir, maxDist, excludeBody) {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = world.castRay(ray, maxDist, true, undefined, undefined, undefined, excludeBody);
    return hit ? (hit.timeOfImpact ?? hit.toi) : null;
  }
  return { RAPIER, world, raycast };
}

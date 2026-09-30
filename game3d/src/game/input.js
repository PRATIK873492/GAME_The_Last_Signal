/* =====================================================================
   INPUT: keyboard state, mouse-look via Pointer Lock, right-mouse aim.
   ===================================================================== */
export function createInput(canvas) {
  const keys = new Set();
  const input = {
    keys, lookX: 0, lookY: 0, aim: false, fire: false, locked: false,
    down: code => keys.has(code),
    /** Mouse movement since the last frame, then reset. */
    takeLook() { const r = [this.lookX, this.lookY]; this.lookX = this.lookY = 0; return r; },
    pressed: new Set(),        // keys pressed this frame (edge-triggered)
  };
  addEventListener('keydown', e => {
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    if (!keys.has(e.code)) input.pressed.add(e.code);
    keys.add(e.code);
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); input.aim = input.fire = false; });
  canvas.addEventListener('mousedown', e => {
    if (!input.locked) { canvas.requestPointerLock?.()?.catch?.(() => {}); return; }
    if (e.button === 2) input.aim = true;
    if (e.button === 0) input.fire = true;
  });
  addEventListener('mouseup', e => { if (e.button === 2) input.aim = false; if (e.button === 0) input.fire = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  addEventListener('mousemove', e => { if (input.locked) { input.lookX += e.movementX; input.lookY += e.movementY; } });
  document.addEventListener('pointerlockchange', () => { input.locked = document.pointerLockElement === canvas; if (!input.locked) input.aim = input.fire = false; });
  return input;
}

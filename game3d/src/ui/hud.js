/* =====================================================================
   HUD: district, clock, objective, minimap, compact trust widget, FPS.
   Reads from the logic modules (map coordinates) - it never touches 3D.
   ===================================================================== */
import { WORLD, RIVER, BRIDGE, districtAt } from '../core/worldLayout.js';
import { paintGround } from '../world/city.js';
import { AI_COLS, COLONY_INFO, trustOf, hostility, onGTChange } from '../core/gtState.js';

const $ = id => document.getElementById(id);

export function createHud(layout) {
  // Minimap base image: the same ground painting as the 3D world + building footprints.
  const base = paintGround(layout, 512);
  const bg = base.getContext('2d'); const k = 512 / WORLD;
  bg.setTransform(1, 0, 0, 1, 0, 0);                        // paintGround left a scale on this context
  bg.fillStyle = 'rgba(255,255,255,.08)'; bg.fillRect(0, 0, 512, 512);   // lift the dark ground so the map reads
  bg.fillStyle = '#2f6d8a'; bg.fillRect(RIVER.x * k, 0, RIVER.w * k, 512);
  bg.fillStyle = '#44494c'; bg.fillRect(RIVER.x * k, BRIDGE.y * k, RIVER.w * k, BRIDGE.h * k);
  bg.fillStyle = '#6a757b';
  for (const b of layout.buildings) bg.fillRect(b.x * k, b.y * k, Math.max(1, b.w * k), Math.max(1, b.h * k));
  const mm = $('minimap'), mctx = mm.getContext('2d');

  function renderTrust() {
    $('trust').innerHTML = AI_COLS.map(c => {
      const t = trustOf(c), s = hostility(c);
      return `<div class="trow"><span style="color:${COLONY_INFO[c].color}">${COLONY_INFO[c].short}</span>
        <span class="tbar"><i style="width:${t}%"></i></span><span class="stars">${'★'.repeat(s)}<span class="off">${'★'.repeat(5 - s)}</span></span></div>`;
    }).join('');
  }
  renderTrust(); onGTChange(renderTrust);

  let fpsAcc = 0, fpsN = 0, fpsShown = false;
  return {
    toggleFps() { fpsShown = !fpsShown; $('fps').hidden = !fpsShown; },
    setObjective(t) { $('objective').textContent = t; },
    update(dt, player, clock, marker, heading, info) {
      $('district').textContent = districtAt(player.map.x, player.map.y).name;
      const h = Math.floor(clock / 60), m = Math.floor(clock % 60);
      $('clock').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      if (fpsShown) { fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { $('fps').textContent = `${Math.round(fpsN / fpsAcc)} FPS · ${info}`; fpsAcc = 0; fpsN = 0; } }

      // minimap: square map centred on the player, player arrow points where the camera looks
      const S = mm.width, zoom = 3.2, px = player.map.x * k, py = player.map.y * k;
      mctx.save(); mctx.fillStyle = '#000'; mctx.fillRect(0, 0, S, S);
      mctx.translate(S / 2, S / 2); mctx.scale(zoom, zoom); mctx.translate(-px, -py);
      mctx.drawImage(base, 0, 0);
      if (marker.map) {
        mctx.fillStyle = '#f2a93b'; mctx.beginPath(); mctx.arc(marker.map.x * k, marker.map.y * k, 3.2, 0, 6.2832); mctx.fill();
        mctx.strokeStyle = '#000'; mctx.lineWidth = 0.8; mctx.stroke();
      }
      mctx.restore();
      if (marker.map) {   // edge arrow when the marker is off the minimap
        const dx = (marker.map.x * k - px) * zoom, dy = (marker.map.y * k - py) * zoom;
        if (Math.abs(dx) > S / 2 - 6 || Math.abs(dy) > S / 2 - 6) {
          const a = Math.atan2(dy, dx), r = S / 2 - 10;
          mctx.fillStyle = '#f2a93b'; mctx.beginPath(); mctx.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 5, 0, 6.2832); mctx.fill();
        }
      }
      mctx.save(); mctx.translate(S / 2, S / 2); mctx.rotate(heading);
      mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.moveTo(0, -9); mctx.lineTo(6, 7); mctx.lineTo(0, 3); mctx.lineTo(-6, 7); mctx.closePath(); mctx.fill();
      mctx.restore();
    },
  };
}

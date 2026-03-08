// render/render2D.js — Canvas 2D rendering

import * as Core from '../core.js';
import * as Util from '../util.js';
import * as Controls from './controls.js';

// ─── Canvas setup ──────────────────────────────────────────────

export function initCanvases() {
  Core.state.viewportPanel = document.getElementById('viewportPanel');
  Core.state.bgCanvas = document.getElementById('bg');
  Core.state.fgCanvas = document.getElementById('fg');
  Core.state.dbgCanvas = document.getElementById('dbg');
  resizeCanvasesToViewport();
}

export function worldToScreen(wx, wy, wz) {
  if (Core.state.currentView === 'nest') {
    return { sx: wx * Core.TILE_SIZE, sy: wz * Core.TILE_SIZE };
  }
  return { sx: wy * Core.TILE_SIZE, sy: wx * Core.TILE_SIZE };
}

export function applyZoom() {
  [Core.state.bgCanvas, Core.state.fgCanvas, Core.state.dbgCanvas].forEach(canvas => {
    canvas.style.transformOrigin = 'top left';
    canvas.style.transform = `scale(${Core.state.viewZoom})`;
  });
}

export function resizeCanvasesToViewport() {
  const viewportWidth = Core.state.viewportPanel.clientWidth;
  const viewportHeight = Core.state.viewportPanel.clientHeight;
  const blockSize = Core.TILE_SIZE * Core.state.viewZoom;

  Core.state.COLS = Math.max(1, Math.floor(viewportWidth / blockSize));
  Core.state.ROWS = Math.max(1, Math.floor(viewportHeight / blockSize));
  Core.state.canvasWidth = Core.state.COLS * Core.TILE_SIZE;
  Core.state.canvasHeight = Core.state.ROWS * Core.TILE_SIZE;

  Core.state.bgCanvas.width = Core.state.fgCanvas.width = Core.state.canvasWidth;
  Core.state.bgCanvas.height = Core.state.fgCanvas.height = Core.state.canvasHeight;
  Core.state.dbgCanvas.width = Core.state.canvasWidth;
  Core.state.dbgCanvas.height = Core.state.canvasHeight;

  Core.state.bgCtx = Core.state.bgCanvas.getContext('2d');
  Core.state.fgCtx = Core.state.fgCanvas.getContext('2d');
  Core.state.dbgCtx = Core.state.dbgCanvas.getContext('2d');

  applyZoom();
}

// ─── Drawing ───────────────────────────────────────────────────

export function drawBackground() {
  Core.state.bgCtx.clearRect(0, 0, Core.state.canvasWidth, Core.state.canvasHeight);
}

export function drawForeground() {
  const ctx = Core.state.fgCtx;
  ctx.clearRect(0, 0, Core.state.canvasWidth, Core.state.canvasHeight);
  ctx.save();
  ctx.translate(-Core.state.camera1X * Core.TILE_SIZE, -Core.state.camera1Y * Core.TILE_SIZE);

  const renderQueue = [];
  let renderOrder = 0;
  const visible = Controls.getVisibleBlocks();
  const cullBuffer = 1;
  const focusY = Math.floor(
    (Core.state.colonies[Core.state.currentNestIndex]?.player?.y
      ?? Core.state.colonies[0]?.player?.y) || 0
  );
  const isNest = Core.state.currentView === 'nest';
  const Y_FADE_RANGE = 8;

  // ── render-queue helpers ──

  const getZIndex = (wx, wy, wz, layerBias, depthOffset = 0) => {
    if (isNest) return (wz + depthOffset) * 100 + layerBias;
    return (wx + depthOffset) * 10000 - wz * 1000 + layerBias;
  };

  const queue = (wx, wy, wz, layerBias, depthOffset, alpha, draw) => {
    renderQueue.push({
      zIndex: getZIndex(wx, wy, wz, layerBias, depthOffset),
      order: renderOrder++,
      draw: () => {
        const prev = ctx.globalAlpha;
        if (alpha !== 1) ctx.globalAlpha = prev * alpha;
        draw();
        if (alpha !== 1) ctx.globalAlpha = prev;
      }
    });
  };

  const queueRect = (wx, wy, wz, color, ox, oy, w, h, layerBias, depthOffset = 0, alpha = 1) => {
    const p = worldToScreen(wx, wy, wz);
    queue(wx, wy, wz, layerBias, depthOffset, alpha, () => {
      ctx.fillStyle = color;
      ctx.fillRect(p.sx + ox, p.sy + oy, w, h);
    });
  };

  const queueCircle = (wx, wy, wz, color, radius, layerBias, depthOffset = 0, alpha = 1) => {
    const p = worldToScreen(wx, wy, wz);
    queue(wx, wy, wz, layerBias, depthOffset, alpha, () => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  const queueText = (wx, wy, wz, text, color, layerBias, depthOffset = 0, alpha = 1) => {
    const p = worldToScreen(wx, wy, wz);
    queue(wx, wy, wz, layerBias, depthOffset, alpha, () => {
      ctx.fillStyle = color;
      ctx.fillText(text, p.sx, p.sy);
    });
  };

  const entityVisible = (y) => !isNest || Math.floor(y) === focusY;
  const distanceAlpha = (y, minAlpha = 0.18) => {
    if (!isNest) return 1;
    const dist = Math.abs(Math.floor(y) - focusY);
    return Math.max(minAlpha, 1 - Math.min(1, dist / Y_FADE_RANGE));
  };

  // ── Terrain ──

  if (!isNest) {
    const minY = Math.max(0, Math.floor(Core.state.camera1X));
    const maxY = Math.min(Core.WORLD_Y_MAX, Math.ceil(Core.state.camera1X + visible.width + cullBuffer));
    const minX = Math.max(0, Math.floor(Core.state.camera1Y));
    const maxX = Math.min(Core.WORLD_X_MAX, Math.ceil(Core.state.camera1Y + visible.height + cullBuffer));
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        if (Util.isTileType(Util.getBlockAt(x, y, 1), Core.TILE.DIRT)) {
          queueRect(x, y, 1, "#5B3A1E", 0, 0, Core.TILE_SIZE, Core.TILE_SIZE, -90);
        }
      }
    }
  } else {
    const minZ = Math.max(0, Math.floor(Core.state.camera1Y));
    const maxZ = Math.min(Core.WORLD_Z_MAX, Math.ceil(Core.state.camera1Y + visible.height + cullBuffer));
    const minX = Math.max(0, Math.floor(Core.state.camera1X));
    const maxX = Math.min(Core.WORLD_X_MAX, Math.ceil(Core.state.camera1X + visible.width + cullBuffer));

    for (let z = minZ; z < maxZ; z++) {
      for (let x = minX; x < maxX; x++) {
        if (!Util.isTileType(Util.getBlockAt(x, focusY, z), Core.TILE.DIRT)) continue;
        queueRect(x, focusY, z, "#5B3A1E", 0, 0, Core.TILE_SIZE, Core.TILE_SIZE, -90);

        let nearestEmptyDist = Infinity;
        for (let d = 1; d <= Y_FADE_RANGE; d++) {
          const yNeg = focusY - d;
          const yPos = focusY + d;
          if (yNeg >= 0 && Util.isTileType(Util.getBlockAt(x, yNeg, z), Core.TILE.EMPTY)) { nearestEmptyDist = d; break; }
          if (yPos < Core.WORLD_Y_MAX && Util.isTileType(Util.getBlockAt(x, yPos, z), Core.TILE.EMPTY)) { nearestEmptyDist = d; break; }
        }
        if (nearestEmptyDist !== Infinity) {
          const proximity = (Y_FADE_RANGE - nearestEmptyDist + 1) / (Y_FADE_RANGE + 1);
          const overlayAlpha = 0.08 + proximity * 0.30;
          queueRect(x, focusY, z, "#000", 0, 0, Core.TILE_SIZE, Core.TILE_SIZE, -85, 0, overlayAlpha);
        }
      }
    }
  }

  // ── Foods ──

  Core.state.foods.forEach(food => {
    if (food && entityVisible(food.y)) {
      queueRect(food.x, food.y, food.z, "green", 5, 5, Core.TILE_SIZE - 10, Core.TILE_SIZE - 10, 20);
    }
  });

  // ── Colonies ──

  Core.state.colonies.forEach(col => {
    queueRect(col.nest.x, col.nest.y, col.nest.z, "gray", 0, 0, Core.TILE_SIZE, Core.TILE_SIZE, 10, 0, distanceAlpha(col.nest.y, 0.2));
    queueRect(col.nest.sX, col.nest.sY, col.nest.sZ ?? col.nest.z, "purple", 0, 0, Core.TILE_SIZE, Core.TILE_SIZE, 11, 0, distanceAlpha(col.nest.sY, 0.2));

    if (entityVisible(col.player.y)) {
      queueCircle(col.player.x, col.player.y, col.player.z, col.color, Core.TILE_SIZE / 2 - 2, 50, 0.45);
      if (col.player.carrying) {
        queueRect(col.player.x, col.player.y, col.player.z,
          Util.isTileType(col.player.carrying, Core.TILE.FOOD) ? "green" : "white", 4, 4, 6, 6, 80, 0.45);
      }
    }

    col.workers.forEach(w => {
      if (!entityVisible(w.y)) return;
      queueCircle(w.x, w.y, w.z, col.color, Core.TILE_SIZE / 2 - 3, 40, 0.45);
      if (w.carrying) {
        queueRect(w.x, w.y, w.z,
          Util.isTileType(w.carrying, Core.TILE.FOOD) ? "green" : "white", 4, 4, 6, 6, 70, 0.45);
      }
    });

    col.soldiers.forEach(ant => {
      if (entityVisible(ant.y)) {
        queueCircle(ant.x, ant.y, ant.z, col.color, Core.TILE_SIZE * 0.45, 45, 0.45);
      }
    });

    col.eggs.forEach(egg => {
      if (!egg || egg.x === undefined || egg.z === undefined || !entityVisible(egg.y)) return;
      if (egg.carry) {
        queueRect(egg.x, egg.y, egg.z, "white", 4, 4, 6, 6, 65, 0.45);
      } else {
        queueRect(egg.x, egg.y, egg.z, "white", 5, 5, Core.TILE_SIZE - 10, Core.TILE_SIZE - 10, 15, 0.45);
      }
    });
  });

  // ── Spiders ──

  Core.state.spiders.forEach(s => {
    if (entityVisible(s.y)) {
      queueRect(s.x, s.y, s.z, s.timer > 0 ? "white" : "darkblue", 0, 0, Core.TILE_SIZE, Core.TILE_SIZE, 60, 0.45);
    }
  });

  // ── Skulls ──

  Core.state.skulls.forEach(sk => {
    if (entityVisible(sk.y)) {
      queueText(sk.x, sk.y, sk.z, "\u{1F480}", "white", 90, 0.45);
    }
  });

  // ── Sort & draw ──

  renderQueue.sort((a, b) => a.zIndex === b.zIndex ? a.order - b.order : a.zIndex - b.zIndex);
  renderQueue.forEach(item => item.draw());
  ctx.restore();
}

export function drawDebug() {
  const ctx = Core.state.dbgCtx;
  clearDebug();
  ctx.save();
  ctx.translate(-Core.state.camera1X * Core.TILE_SIZE, -Core.state.camera1Y * Core.TILE_SIZE);

  Core.state.colonies.forEach(col => {
    col.workers.forEach(w => {
      if (w.path) {
        ctx.fillStyle = Util.hexToRgba("#ffff00", (1.0 - (w.pathIndex / w.path.length)) * 0.15);
        w.path.forEach(next => {
          const t = worldToScreen(next.x, next.y, next.z);
          ctx.fillRect(t.sx, t.sy, Core.TILE_SIZE, Core.TILE_SIZE);
        });
      }
    });
  });

  ctx.restore();
}

export function clearDebug() {
  Core.state.dbgCtx.clearRect(0, 0, Core.state.canvasWidth, Core.state.canvasHeight);
}

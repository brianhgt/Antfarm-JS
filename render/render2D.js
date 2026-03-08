// render/render2D.js — Canvas 2D rendering

import {
  TILE, TILE_SIZE, WORLD_X_MAX, WORLD_Y_MAX, WORLD_Z_MAX, state
} from '../core.js';
import { isTileType, getBlockAt, hexToRgba } from '../util.js';
import { getVisibleBlocks } from './controls.js';

// ─── Canvas setup ──────────────────────────────────────────────

export function initCanvases() {
  state.viewportPanel = document.getElementById('viewportPanel');
  state.bgCanvas = document.getElementById('bg');
  state.fgCanvas = document.getElementById('fg');
  state.dbgCanvas = document.getElementById('dbg');
  resizeCanvasesToViewport();
}

export function worldToScreen(wx, wy, wz) {
  if (state.currentView === 'nest') {
    return { sx: wx * TILE_SIZE, sy: wz * TILE_SIZE };
  }
  return { sx: wy * TILE_SIZE, sy: wx * TILE_SIZE };
}

export function applyZoom() {
  [state.bgCanvas, state.fgCanvas, state.dbgCanvas].forEach(canvas => {
    canvas.style.transformOrigin = 'top left';
    canvas.style.transform = `scale(${state.viewZoom})`;
  });
}

export function resizeCanvasesToViewport() {
  const viewportWidth = state.viewportPanel.clientWidth;
  const viewportHeight = state.viewportPanel.clientHeight;
  const blockSize = TILE_SIZE * state.viewZoom;

  state.COLS = Math.max(1, Math.floor(viewportWidth / blockSize));
  state.ROWS = Math.max(1, Math.floor(viewportHeight / blockSize));
  state.canvasWidth = state.COLS * TILE_SIZE;
  state.canvasHeight = state.ROWS * TILE_SIZE;

  state.bgCanvas.width = state.fgCanvas.width = state.canvasWidth;
  state.bgCanvas.height = state.fgCanvas.height = state.canvasHeight;
  state.dbgCanvas.width = state.canvasWidth;
  state.dbgCanvas.height = state.canvasHeight;

  state.bgCtx = state.bgCanvas.getContext('2d');
  state.fgCtx = state.fgCanvas.getContext('2d');
  state.dbgCtx = state.dbgCanvas.getContext('2d');

  applyZoom();
}

// ─── Drawing ───────────────────────────────────────────────────

export function drawBackground() {
  state.bgCtx.clearRect(0, 0, state.canvasWidth, state.canvasHeight);
}

export function drawForeground() {
  const ctx = state.fgCtx;
  ctx.clearRect(0, 0, state.canvasWidth, state.canvasHeight);
  ctx.save();
  ctx.translate(-state.camera1X * TILE_SIZE, -state.camera1Y * TILE_SIZE);

  const renderQueue = [];
  let renderOrder = 0;
  const visible = getVisibleBlocks();
  const cullBuffer = 1;
  const focusY = Math.floor(
    (state.colonies[state.currentNestIndex]?.player?.y
      ?? state.colonies[0]?.player?.y) || 0
  );
  const isNest = state.currentView === 'nest';
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
    const minY = Math.max(0, Math.floor(state.camera1X));
    const maxY = Math.min(WORLD_Y_MAX, Math.ceil(state.camera1X + visible.width + cullBuffer));
    const minX = Math.max(0, Math.floor(state.camera1Y));
    const maxX = Math.min(WORLD_X_MAX, Math.ceil(state.camera1Y + visible.height + cullBuffer));
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        if (isTileType(getBlockAt(x, y, 1), TILE.DIRT)) {
          queueRect(x, y, 1, "#5B3A1E", 0, 0, TILE_SIZE, TILE_SIZE, -90);
        }
      }
    }
  } else {
    const minZ = Math.max(0, Math.floor(state.camera1Y));
    const maxZ = Math.min(WORLD_Z_MAX, Math.ceil(state.camera1Y + visible.height + cullBuffer));
    const minX = Math.max(0, Math.floor(state.camera1X));
    const maxX = Math.min(WORLD_X_MAX, Math.ceil(state.camera1X + visible.width + cullBuffer));

    for (let z = minZ; z < maxZ; z++) {
      for (let x = minX; x < maxX; x++) {
        if (!isTileType(getBlockAt(x, focusY, z), TILE.DIRT)) continue;
        queueRect(x, focusY, z, "#5B3A1E", 0, 0, TILE_SIZE, TILE_SIZE, -90);

        let nearestEmptyDist = Infinity;
        for (let d = 1; d <= Y_FADE_RANGE; d++) {
          const yNeg = focusY - d;
          const yPos = focusY + d;
          if (yNeg >= 0 && isTileType(getBlockAt(x, yNeg, z), TILE.EMPTY)) { nearestEmptyDist = d; break; }
          if (yPos < WORLD_Y_MAX && isTileType(getBlockAt(x, yPos, z), TILE.EMPTY)) { nearestEmptyDist = d; break; }
        }
        if (nearestEmptyDist !== Infinity) {
          const proximity = (Y_FADE_RANGE - nearestEmptyDist + 1) / (Y_FADE_RANGE + 1);
          const overlayAlpha = 0.08 + proximity * 0.30;
          queueRect(x, focusY, z, "#000", 0, 0, TILE_SIZE, TILE_SIZE, -85, 0, overlayAlpha);
        }
      }
    }
  }

  // ── Foods ──

  state.foods.forEach(food => {
    if (food && entityVisible(food.y)) {
      queueRect(food.x, food.y, food.z, "green", 5, 5, TILE_SIZE - 10, TILE_SIZE - 10, 20);
    }
  });

  // ── Colonies ──

  state.colonies.forEach(col => {
    queueRect(col.nest.x, col.nest.y, col.nest.z, "gray", 0, 0, TILE_SIZE, TILE_SIZE, 10, 0, distanceAlpha(col.nest.y, 0.2));
    queueRect(col.nest.sX, col.nest.sY, col.nest.sZ ?? col.nest.z, "purple", 0, 0, TILE_SIZE, TILE_SIZE, 11, 0, distanceAlpha(col.nest.sY, 0.2));

    if (entityVisible(col.player.y)) {
      queueCircle(col.player.x, col.player.y, col.player.z, col.color, TILE_SIZE / 2 - 2, 50, 0.45);
      if (col.player.carrying) {
        queueRect(col.player.x, col.player.y, col.player.z,
          isTileType(col.player.carrying, TILE.FOOD) ? "green" : "white", 4, 4, 6, 6, 80, 0.45);
      }
    }

    col.workers.forEach(w => {
      if (!entityVisible(w.y)) return;
      queueCircle(w.x, w.y, w.z, col.color, TILE_SIZE / 2 - 3, 40, 0.45);
      if (w.carrying) {
        queueRect(w.x, w.y, w.z,
          isTileType(w.carrying, TILE.FOOD) ? "green" : "white", 4, 4, 6, 6, 70, 0.45);
      }
    });

    col.soldiers.forEach(ant => {
      if (entityVisible(ant.y)) {
        queueCircle(ant.x, ant.y, ant.z, col.color, TILE_SIZE * 0.45, 45, 0.45);
      }
    });

    col.eggs.forEach(egg => {
      if (!egg || egg.x === undefined || egg.z === undefined || !entityVisible(egg.y)) return;
      if (egg.carry) {
        queueRect(egg.x, egg.y, egg.z, "white", 4, 4, 6, 6, 65, 0.45);
      } else {
        queueRect(egg.x, egg.y, egg.z, "white", 5, 5, TILE_SIZE - 10, TILE_SIZE - 10, 15, 0.45);
      }
    });
  });

  // ── Spiders ──

  state.spiders.forEach(s => {
    if (entityVisible(s.y)) {
      queueRect(s.x, s.y, s.z, s.timer > 0 ? "white" : "darkblue", 0, 0, TILE_SIZE, TILE_SIZE, 60, 0.45);
    }
  });

  // ── Skulls ──

  state.skulls.forEach(sk => {
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
  const ctx = state.dbgCtx;
  clearDebug();
  ctx.save();
  ctx.translate(-state.camera1X * TILE_SIZE, -state.camera1Y * TILE_SIZE);

  state.colonies.forEach(col => {
    col.workers.forEach(w => {
      if (w.path) {
        ctx.fillStyle = hexToRgba("#ffff00", (1.0 - (w.pathIndex / w.path.length)) * 0.15);
        w.path.forEach(next => {
          const t = worldToScreen(next.x, next.y, next.z);
          ctx.fillRect(t.sx, t.sy, TILE_SIZE, TILE_SIZE);
        });
      }
    });
  });

  ctx.restore();
}

export function clearDebug() {
  state.dbgCtx.clearRect(0, 0, state.canvasWidth, state.canvasHeight);
}

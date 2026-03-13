// render/render2D.js — Canvas 2D rendering

import * as Core from '../core.js';
import * as Util from '../util/util.js';
import * as ColorUtil from '../util/ColorUtil.js';
import * as Controls from './controls.js';

const PHEROMONE_RENDER_CONFIG = [
  { type: 'trail', enabledKey: 'showTrailPheromones' },
  { type: 'footprint', enabledKey: 'showFootprintPheromones' },
  { type: 'alarm', enabledKey: 'showAlarmPheromones' }
];

const NEST_Y_FADE_RANGE = 8;

let surfaceTerrainCanvas = null;
let surfaceTerrainCtx = null;
let nestTerrainCanvas = null;
let nestTerrainCtx = null;
let surfaceTerrainBuilt = false;
let nestTerrainBuilt = false;
let nestTerrainDirty = true;
let lastNestFocusY = -1;

function createCacheCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function ensureTerrainCaches() {
  const surfaceWidth = Core.WORLD_Y_MAX * Core.TILE_SIZE;
  const surfaceHeight = Core.WORLD_X_MAX * Core.TILE_SIZE;
  const nestWidth = Core.WORLD_X_MAX * Core.TILE_SIZE;
  const nestHeight = Core.WORLD_Z_MAX * Core.TILE_SIZE;

  if (!surfaceTerrainCanvas || surfaceTerrainCanvas.width !== surfaceWidth || surfaceTerrainCanvas.height !== surfaceHeight) {
    surfaceTerrainCanvas = createCacheCanvas(surfaceWidth, surfaceHeight);
    surfaceTerrainCtx = surfaceTerrainCanvas.getContext('2d');
    surfaceTerrainBuilt = false;
  }

  if (!nestTerrainCanvas || nestTerrainCanvas.width !== nestWidth || nestTerrainCanvas.height !== nestHeight) {
    nestTerrainCanvas = createCacheCanvas(nestWidth, nestHeight);
    nestTerrainCtx = nestTerrainCanvas.getContext('2d');
    nestTerrainBuilt = false;
    nestTerrainDirty = true;
  }
}

function getFocusY() {
  return Math.floor(
    (Core.state.colonies[Core.state.currentNestIndex]?.player?.y
      ?? Core.state.colonies[0]?.player?.y) || 0
  );
}

function clearSurfaceTile(x, y) {
  surfaceTerrainCtx.clearRect(y * Core.TILE_SIZE, x * Core.TILE_SIZE, Core.TILE_SIZE, Core.TILE_SIZE);
}

function drawSurfaceTileToCache(x, y) {
  clearSurfaceTile(x, y);
  if (Util.isTileType(Util.getBlockAt(x, y, 1), Core.TILE.DIRT)) {
    surfaceTerrainCtx.fillStyle = '#5B3A1E';
    surfaceTerrainCtx.fillRect(y * Core.TILE_SIZE, x * Core.TILE_SIZE, Core.TILE_SIZE, Core.TILE_SIZE);
  }
}

function rebuildSurfaceTerrainCache() {
  ensureTerrainCaches();
  surfaceTerrainCtx.clearRect(0, 0, surfaceTerrainCanvas.width, surfaceTerrainCanvas.height);
  for (let y = 0; y < Core.WORLD_Y_MAX; y++) {
    for (let x = 0; x < Core.WORLD_X_MAX; x++) {
      drawSurfaceTileToCache(x, y);
    }
  }
  surfaceTerrainBuilt = true;
}

function rebuildNestTerrainCache(focusY) {
  ensureTerrainCaches();
  nestTerrainCtx.clearRect(0, 0, nestTerrainCanvas.width, nestTerrainCanvas.height);

  for (let z = 0; z < Core.WORLD_Z_MAX; z++) {
    for (let x = 0; x < Core.WORLD_X_MAX; x++) {
      if (!Util.isTileType(Util.getBlockAt(x, focusY, z), Core.TILE.DIRT)) continue;

      nestTerrainCtx.fillStyle = '#5B3A1E';
      nestTerrainCtx.fillRect(x * Core.TILE_SIZE, z * Core.TILE_SIZE, Core.TILE_SIZE, Core.TILE_SIZE);

      let nearestEmptyDist = Infinity;
      for (let d = 1; d <= NEST_Y_FADE_RANGE; d++) {
        const yNeg = focusY - d;
        const yPos = focusY + d;
        if (yNeg >= 0 && Util.isTileType(Util.getBlockAt(x, yNeg, z), Core.TILE.EMPTY)) { nearestEmptyDist = d; break; }
        if (yPos < Core.WORLD_Y_MAX && Util.isTileType(Util.getBlockAt(x, yPos, z), Core.TILE.EMPTY)) { nearestEmptyDist = d; break; }
      }

      if (nearestEmptyDist !== Infinity) {
        const proximity = (NEST_Y_FADE_RANGE - nearestEmptyDist + 1) / (NEST_Y_FADE_RANGE + 1);
        const overlayAlpha = 0.08 + proximity * 0.30;
        nestTerrainCtx.fillStyle = `rgba(0, 0, 0, ${overlayAlpha})`;
        nestTerrainCtx.fillRect(x * Core.TILE_SIZE, z * Core.TILE_SIZE, Core.TILE_SIZE, Core.TILE_SIZE);
      }
    }
  }

  nestTerrainBuilt = true;
  nestTerrainDirty = false;
  lastNestFocusY = focusY;
}

function consumeTerrainDirty() {
  if (Core.state.viewMapDirty.size === 0) return;

  if (!surfaceTerrainBuilt) {
    rebuildSurfaceTerrainCache();
  }

  for (const [hash] of Core.state.viewMapDirty) {
    const { x, y, z } = Util.getBlockLocationAtKey(hash);
    if (z === 1) {
      drawSurfaceTileToCache(x, y);
    }
    nestTerrainDirty = true;
  }

  Core.state.viewMapDirty.clear();
}

function ensureTerrainFresh() {
  const focusY = getFocusY();
  ensureTerrainCaches();

  if (!surfaceTerrainBuilt) {
    rebuildSurfaceTerrainCache();
    Core.state.viewMapDirty.clear();
    nestTerrainDirty = true;
  }

  else {
    consumeTerrainDirty();
  }

  if (!nestTerrainBuilt || nestTerrainDirty || lastNestFocusY !== focusY) {
    rebuildNestTerrainCache(focusY);
  }
}

// ─── Canvas setup ──────────────────────────────────────────────

export function initCanvases() {
  Core.state.viewportPanel = document.getElementById('viewportPanel');
  Core.state.bgCanvas = document.getElementById('bg');
  Core.state.fgCanvas = document.getElementById('fg');
  Core.state.dbgCanvas = document.getElementById('dbg');
  resizeCanvasesToViewport();
}

export function switchTo2D() {
  const container = document.getElementById('view3D');
  if (container) container.remove();
  Core.state.bgCanvas.style.display = '';
  Core.state.fgCanvas.style.display = '';
  Core.state.dbgCanvas.style.display = '';
  resizeCanvasesToViewport();
}

export function worldToScreenView(wx, wy, wz, view) {
    if (view === 'nest') {
        return worldToScreen(wx, wy, wz, 'XZ');
    } else if (view === 'surface') {
        return worldToScreen(wx, wy, wz, 'YZ');
    }
    return worldToScreen(wx, wy, wz, 'YZ');
}

export function worldToScreen(wx, wy, wz, transform) {
  if (transform === 'XZ') {
    // For nest view: X horizontal, Z vertical
    return { sx: wx * Core.TILE_SIZE, sy: wz * Core.TILE_SIZE };
  }
  else if (transform === 'YZ') {
    // For surface/overworld view: Y horizontal, X vertical (match previous layout)
    return { sx: wy * Core.TILE_SIZE, sy: wx * Core.TILE_SIZE };
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
  ensureTerrainFresh();

  const ctx = Core.state.bgCtx;
  ctx.clearRect(0, 0, Core.state.canvasWidth, Core.state.canvasHeight);

  const srcX = Math.floor(Core.state.camera1X * Core.TILE_SIZE);
  const srcY = Math.floor(Core.state.camera1Y * Core.TILE_SIZE);
  const sourceCanvas = Core.state.currentView === 'nest' ? nestTerrainCanvas : surfaceTerrainCanvas;

  ctx.drawImage(
    sourceCanvas,
    srcX,
    srcY,
    Core.state.canvasWidth,
    Core.state.canvasHeight,
    0,
    0,
    Core.state.canvasWidth,
    Core.state.canvasHeight
  );
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
  const focusY = getFocusY();
  const isNest = Core.state.currentView === 'nest';

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
    const p = worldToScreenView(wx, wy, wz, Core.state.currentView);
    queue(wx, wy, wz, layerBias, depthOffset, alpha, () => {
      ctx.fillStyle = color;
      ctx.fillRect(p.sx + ox, p.sy + oy, w, h);
    });
  };

  const queueCircle = (wx, wy, wz, color, radius, layerBias, depthOffset = 0, alpha = 1) => {
    const p = worldToScreenView(wx, wy, wz, Core.state.currentView);
    queue(wx, wy, wz, layerBias, depthOffset, alpha, () => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  const queueText = (wx, wy, wz, text, color, layerBias, depthOffset = 0, alpha = 1) => {
    const p = worldToScreenView(wx, wy, wz, Core.state.currentView);
    queue(wx, wy, wz, layerBias, depthOffset, alpha, () => {
      ctx.fillStyle = color;
      ctx.fillText(text, p.sx, p.sy);
    });
  };

  const entityVisible = (y) => !isNest || Math.floor(y) === focusY;
  const distanceAlpha = (y, minAlpha = 0.18) => {
    if (!isNest) return 1;
    const dist = Math.abs(Math.floor(y) - focusY);
    return Math.max(minAlpha, 1 - Math.min(1, dist / NEST_Y_FADE_RANGE));
  };
  const pheromoneVisible = (x, y, z) => {
    if (isNest) {
      return Math.floor(y) === focusY &&
        x >= Math.floor(Core.state.camera1X) - cullBuffer &&
        x <= Math.ceil(Core.state.camera1X + visible.width + cullBuffer) &&
        z >= Math.floor(Core.state.camera1Y) - cullBuffer &&
        z <= Math.ceil(Core.state.camera1Y + visible.height + cullBuffer);
    }

    return z === 0 &&
      y >= Math.floor(Core.state.camera1X) - cullBuffer &&
      y <= Math.ceil(Core.state.camera1X + visible.width + cullBuffer) &&
      x >= Math.floor(Core.state.camera1Y) - cullBuffer &&
      x <= Math.ceil(Core.state.camera1Y + visible.height + cullBuffer);
  };

  // ── Pheromones ──

  PHEROMONE_RENDER_CONFIG.forEach(({ type, enabledKey }) => {
    if (!Core.state[enabledKey]) return;

    Core.state.colonies.forEach(col => {
      const pheromoneMap = col.pheromones?.[type];
      const color = col.pheromoneColors?.[type] ?? col.color;
      if (!(pheromoneMap instanceof Map)) return;

      pheromoneMap.forEach((strength, key) => {
        if (strength <= Core.PHEROMONE_MIN_STRENGTH) return;
        const { x, y, z } = Util.getBlockLocationAtKey(key);
        if (!pheromoneVisible(x, y, z)) return;
        queueRect(
          x, y, z,
          color,
          3, 3,
          Core.TILE_SIZE - 6,
          Core.TILE_SIZE - 6,
          -20,
          0,
          Math.min(1, strength)
        );
      });
    });
  });

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
        ctx.fillStyle = ColorUtil.hexToRgba("#ffff00", (1.0 - (w.pathIndex / w.path.length)) * 0.15);
        w.path.forEach(next => {
          const t = worldToScreenView(next.x, next.y, next.z, Core.state.currentView);
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

// ─── Mini-map ─────────────────────────────────────────────────

export function drawMiniMap() {
  if (!Core.state.showMiniMap) return;

  const canvas = Core.state.miniMapCanvas;
  const ctx = Core.state.miniMapCtx;
  if (!canvas || !ctx) return;

  const cw = canvas.width;
  const ch = canvas.height;
  ctx.save();
  ctx.clearRect(0, 0, cw, ch);

  const tileW = cw / Core.WORLD_Y_MAX;
  const tileH = ch / Core.WORLD_X_MAX;

  // Helper to convert world coords -> mini-map coords using worldToScreen orientation
  const toMini = (wx, wy, wz) => {
    const p = worldToScreen(wx, wy, wz, "XY");
    return {
      x: (p.sx / Core.TILE_SIZE) * tileW,
      y: (p.sy / Core.TILE_SIZE) * tileH
    };
  };

  // Draw terrain (surface z=1)
  for (let y = 0; y < Core.WORLD_Y_MAX; y++) {
    for (let x = 0; x < Core.WORLD_X_MAX; x++) {
      const t = Util.getBlockAt(x, y, 1);
      if (Util.isTileType(t, Core.TILE.DIRT)) {
        const m = toMini(x, y, 1);
        ctx.fillStyle = '#5B3A1E';
        ctx.fillRect(Math.floor(m.x), Math.floor(m.y), Math.ceil(tileW), Math.ceil(tileH));
      }
    }
  }

  // Foods
  ctx.fillStyle = 'green';
  Core.state.foods.forEach(food => {
    const m = toMini(food.x, food.y, food.z);
    ctx.fillRect(m.x + tileW * 0.2, m.y + tileH * 0.2, Math.max(1, tileW * 0.6), Math.max(1, tileH * 0.6));
  });

  // Colonies (nests + players + ants)
  Core.state.colonies.forEach(col => {
    // nest
    const mn = toMini(col.nest.x, col.nest.y, col.nest.z);
    ctx.fillStyle = col.color || 'white';
    ctx.fillRect(mn.x, mn.y, Math.max(1, tileW * 1.5), Math.max(1, tileH * 1.5));

    // player
    if (col.player) {
      const mp = toMini(col.player.x, col.player.y, col.player.z);
      ctx.fillStyle = col.color || 'white';
      ctx.beginPath();
      ctx.arc(mp.x, mp.y, Math.max(1, Math.min(tileW, tileH) * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }

    // workers
    ctx.fillStyle = col.color || 'white';
    col.workers.forEach(w => {
      const mw = toMini(w.x, w.y, w.z);
      ctx.fillRect(mw.x + tileW * 0.25, mw.y + tileH * 0.25, Math.max(1, tileW * 0.5), Math.max(1, tileH * 0.5));
    });

    // soldiers
    col.soldiers.forEach(s => {
      const ms = toMini(s.x, s.y, s.z);
      ctx.fillRect(ms.x + tileW * 0.25, ms.y + tileH * 0.25, Math.max(1, tileW * 0.5), Math.max(1, tileH * 0.5));
    });
  });

  // Spiders
  ctx.fillStyle = 'darkblue';
  Core.state.spiders.forEach(s => {
    const ms = toMini(s.x, s.y, s.z);
    ctx.fillRect(ms.x + tileW * 0.15, ms.y + tileH * 0.15, Math.max(1, tileW * 0.7), Math.max(1, tileH * 0.7));
  });

  // Skulls
  ctx.fillStyle = 'white';
  Core.state.skulls.forEach(sk => {
    const msk = toMini(sk.x, sk.y, sk.z);
    ctx.fillRect(msk.x + tileW * 0.4, msk.y + tileH * 0.4, Math.max(1, tileW * 0.2), Math.max(1, tileH * 0.2));
  });

  ctx.restore();
}

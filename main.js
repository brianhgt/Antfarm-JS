// main.js — ES module entry point

import {
  TILE, ANT_TYPE, TILE_OPEN_SPACE, EGG_HATCH_TIME, SPIDER_COOLDOWN,
  WORLD_X_MAX, WORLD_Y_MAX, WORLD_Z_MAX, NEST_MAX_DEPTH, DEFAULT_NEST_Y,
  state
} from './core.js';
import * as Util from './util.js';
import * as Render2D from './render/render2D.js';
import * as Controls from './render/controls.js';
import * as ControlPanel from './render/controlPanel.js';
import * as Player from './entities/player.js';
import { updateSpiders, updateSkulls } from './entities/enemy.js';
import * as AI from './systems/ai.js';
import { spawnFood } from './systems/physics.js';

const jq = jQuery.noConflict();

// ─── World initialization ──────────────────────────────────────

function initWorld() {
  // Build 3D viewMap
  for (let x = 0; x < WORLD_X_MAX; x++) {
    const plane = [];
    for (let y = 0; y < WORLD_Y_MAX; y++) {
      const column = [];
      for (let z = 0; z < WORLD_Z_MAX; z++) {
        column.push(Util.createTile(z < TILE_OPEN_SPACE ? TILE.EMPTY : TILE.DIRT));
      }
      plane.push(column);
    }
    state.viewMap.push(plane);
  }

  // Initial food on surface
  for (let i = 0; i < state.foodSpawnAmount; i++) {
    const fx = Math.floor(Math.random() * WORLD_X_MAX);
    const fy = Math.floor(Math.random() * WORLD_Y_MAX);
    const fz = 0;
    state.foods.set(Util.get3dHash(fx, fy, fz), { x: fx, y: fy, z: fz, carry: false });
  }

  // Colonies
  state.colonies = [
    { name: "A", color: "black", nest: {}, eggs: new Map(), workers: [], soldiers: [], player: {}, score: 0, playerTarget: null },
    { name: "B", color: "red",   nest: {}, eggs: new Map(), workers: [], soldiers: [], player: {}, score: 0, playerTarget: null }
  ];

  // Spiders
  for (let i = 0; i < state.numSpiders; i++) {
    state.spiders.push({
      x: Math.floor(Math.random() * WORLD_X_MAX),
      y: Math.floor(Math.random() * WORLD_Y_MAX),
      z: 0,
      target: null, path: null, pathIndex: 0,
      timer: EGG_HATCH_TIME, cooldownTimer: SPIDER_COOLDOWN
    });
  }

  // Initialize nests
  state.colonies.forEach((col, colIdx) => {
    const nx = 4 + Math.floor(Math.random() * (WORLD_X_MAX - 4));
    const ny = DEFAULT_NEST_Y;
    const nz = 2 + 1 + Math.min(Math.floor(Math.random() * (WORLD_Z_MAX - 4)), NEST_MAX_DEPTH);

    Util.setBlock(nx, ny, nz, TILE.NEST);
    Util.setBlock(nx, ny, nz + 1, TILE.NEST);

    // Clear around nest
    for (let x = nx - 1; x <= nx + 1; x++) {
      for (let z = nz - 1; z <= nz + 2; z++) {
        if (x >= 0 && x < WORLD_X_MAX && z >= 0 && z < WORLD_Z_MAX) {
          if (Util.isTileType(Util.getBlockAt(x, ny, z), TILE.DIRT)) {
            Util.setBlock(x, ny, z, TILE.EMPTY);
          }
        }
      }
    }

    // Horizontal tunnel
    for (let i = 1; i <= 3; i++) {
      Util.setBlock(nx - i, ny, nz + 1, TILE.EMPTY);
      Util.setBlock(nx - i, ny, nz + 2, TILE.EMPTY);
    }

    // Vertical tunnel to surface with random jitter
    let xShift = 0;
    for (let z = nz + 2; z > 0; z--) {
      Util.setBlock(nx - 3 + xShift, ny, z, TILE.EMPTY);
      if (Math.random() < 0.1) {
        xShift += Math.ceil(Math.random() * 3 - 2);
        Util.setBlock(nx - 3 + xShift, ny, z, TILE.EMPTY);
      }
    }

    col.nest = { x: nx, y: ny, z: nz, sX: nx, sY: ny, sZ: nz + 1 };
    col.player = { x: nx + 0.5, y: ny + 0.5, z: nz + 0.5, carrying: null };

    // Spawn initial egg
    const ex = nx + 1, ey = ny, ez = nz;
    Util.setBlock(ex, ey, ez, TILE.EMPTY);
    col.eggs.set(Util.get3dHash(ex, ey, ez), {
      x: ex, y: ey, z: ez,
      type: ANT_TYPE.WORKER, timer: EGG_HATCH_TIME, carry: false
    });
  });
}

// ─── Update ────────────────────────────────────────────────────

function update(delta) {
  spawnFood(delta);
  Player.updatePlayers(delta);

  state.colonies.forEach((col, idx) => {
    AI.hatchEggs(col, idx, delta);
    AI.updateWorkers(col, delta);
    AI.updateSoldiers(col, delta);
  });

  updateSpiders(delta);
  updateSkulls();
}

// ─── Game loop ─────────────────────────────────────────────────

let _lastTimestamp = performance.now();

function gameLoop(timestamp) {
  const delta = (timestamp - _lastTimestamp) / 1000;
  _lastTimestamp = timestamp;

  const instantFps = delta > 0 ? 1 / delta : 0;
  state.fpsSmoothed = state.fpsSmoothed * 0.9 + instantFps * 0.1;

  const workersCount  = state.colonies.reduce((t, c) => t + c.workers.length, 0);
  const soldiersCount = state.colonies.reduce((t, c) => t + c.soldiers.length, 0);
  const totalAnts     = workersCount + soldiersCount;

  ControlPanel.updateStats(
    Math.round(state.fpsSmoothed), state.viewZoom, totalAnts,
    state.antDeaths, workersCount, soldiersCount,
    state.spiders.length, state.foods.size
  );

  update(delta);
  Render2D.drawBackground();
  Render2D.drawForeground();
  Render2D.drawMiniMap();
  if (state.showDebugPaths) Render2D.drawDebug();
  requestAnimationFrame(gameLoop);
}

// ─── Bootstrap ─────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  Render2D.initCanvases();
  initWorld();
  Controls.setupInput(state.dbgCanvas);
  ControlPanel.initControlPanel(jq);

  // Resize handler
  window.addEventListener('resize', () => {
    Render2D.resizeCanvasesToViewport();
    Controls.clampCameraToViewBounds();
    Render2D.drawBackground();
  });

  Render2D.drawBackground();
  requestAnimationFrame(gameLoop);
});

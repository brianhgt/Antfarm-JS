// main.js — ES module entry point

import {
  TILE, ANT_TYPE, TILE_OPEN_SPACE, EGG_HATCH_TIME, SPIDER_COOLDOWN,
  WORLD_X_MAX, WORLD_Y_MAX, WORLD_Z_MAX, NEST_MAX_DEPTH, DEFAULT_NEST_Y,
  state
} from './core.js';
import * as Core from './core.js';
import * as Util from './util/util.js';
import * as Render2D from './render/render2D.js';
import * as Render3D from './render/render3D.js';
import * as Controls from './render/controls.js';
import * as ControlPanel from './render/controlPanel.js';
import * as Player from './entities/player.js';
import { updateSpiders, updateSkulls } from './entities/enemy.js';
import * as AI from './systems/ai.js';
import * as AIPheromone from './systems/aiPheromone.js';
import { spawnFood, spawnFoodClumps, updateEvaluationMaps, updatePheromones } from './systems/physics.js';

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
    const fx = Math.floor(Core.worldRandom() * WORLD_X_MAX);
    const fy = Math.floor(Core.worldRandom() * WORLD_Y_MAX);
    const fz = 0;
    state.foods.set(Util.get3dHash(fx, fy, fz), { x: fx, y: fy, z: fz, carry: false });
  }

  // Colonies
  state.colonies = [
    {
      index: 0,
      name: "A",
      aiType: 'pheromone',
      foragerRatio: 0.3,
      color: "black",
      pheromoneColors: { trail: '#f7a531', footprint: '#57c7ff', alarm: '#ff4d5a' },
      pheromones: { trail: new Map(), alarm: new Map(), footprint: new Map() },
      evaluationMap: new Map(),
      nest: {}, eggs: new Map(), workers: [], soldiers: [], player: {}, score: 0, playerTarget: null
    },
    {
      index: 1,
      name: "B",
      aiType: 'pheromone',
      color: "red",
      pheromoneColors: { trail: '#8dff5a', footprint: '#b17cff', alarm: '#ff79c6' },
      pheromones: { trail: new Map(), alarm: new Map(), footprint: new Map() },
      evaluationMap: new Map(),
      nest: {}, eggs: new Map(), workers: [], soldiers: [], player: {}, score: 0, playerTarget: null
    }
  ];

  state.trailPheromoneMaps = state.colonies.map(col => col.pheromones.trail);
  state.alarmPheromoneMaps = state.colonies.map(col => col.pheromones.alarm);
  state.footprintPheromoneMaps = state.colonies.map(col => col.pheromones.footprint);
  state.evaluationMaps = state.colonies.map(col => col.evaluationMap);

  // Spiders
  for (let i = 0; i < state.numSpiders; i++) {
    state.spiders.push({
      x: Math.floor(Core.worldRandom() * WORLD_X_MAX),
      y: Math.floor(Core.worldRandom() * WORLD_Y_MAX),
      z: 0,
      target: null, path: null, pathIndex: 0,
      timer: EGG_HATCH_TIME, cooldownTimer: SPIDER_COOLDOWN
    });
  }

  // Initialize nests
  state.colonies.forEach((col, colIdx) => {
    const nx = 4 + Math.floor(Core.worldRandom() * (WORLD_X_MAX - 4));
    const ny = DEFAULT_NEST_Y;
    const nz = 2 + 1 + Math.min(Math.floor(Core.worldRandom() * (WORLD_Z_MAX - 4)), NEST_MAX_DEPTH);

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
      if (Core.worldRandom() < 0.1) {
        xShift += Math.ceil(Core.worldRandom() * 3 - 2);
        Util.setBlock(nx - 3 + xShift, ny, z, TILE.EMPTY);
      }
    }

    col.nest = { x: nx, y: ny, z: nz, sX: nx, sY: ny, sZ: nz + 1 };
    col.player = { x: nx + 0.5, y: ny + 0.5, z: nz + 0.5, carrying: null };

    // Spawn initial egg(s)
    for (let i = 0; i <= 6; i++) {
      const {x, y, z} = Util.getRandomNearbyEmptyTile(nx, ny, nz, 1, 2);
      col.eggs.set(Util.get3dHash(x, y, z), {
        x: x, y: y, z: z,
        type: ANT_TYPE.WORKER, timer: EGG_HATCH_TIME, carry: false, colIdx: colIdx
      });
    }
  });
}

// ─── Update ────────────────────────────────────────────────────

function update(delta) {
  spawnFood(delta);
  spawnFoodClumps(delta);
  Player.updatePlayers(delta);

  state.colonies.forEach((col, idx) => {
    AI.hatchEggs(col, idx, delta);
    if (col.aiType === 'pheromone') {
      AIPheromone.updateWorkers(col, idx, delta);
    } else {
      AI.updateWorkers(col, idx, delta);
    }
    AI.updateSoldiers(col, idx, delta);
  });

  updatePheromones(delta);
  updateEvaluationMaps(delta);

  updateSpiders(delta);
  updateSkulls();
}

// ─── Game loop ─────────────────────────────────────────────────

let _lastTimestamp = performance.now();
let _lastPhysTimestamp = performance.now();
let _physStepCounter = 0;
let accumulator = 0;
const MAX_FRAME_STEP = 0.25; // clamp very large frame gaps (s)

function gameLoop(timestamp) {
  let delta = (timestamp - _lastTimestamp) / 1000;
  _lastTimestamp = timestamp;

  // Safety clamp to avoid spiral of death after long pauses
  if (delta > MAX_FRAME_STEP) delta = MAX_FRAME_STEP;

  const instantFps = delta > 0 ? 1 / delta : 0;
  state.fpsSmoothed = state.fpsSmoothed * 0.9 + instantFps * 0.1;

  const workersCount  = state.colonies.reduce((t, c) => t + c.workers.length, 0);
  const soldiersCount = state.colonies.reduce((t, c) => t + c.soldiers.length, 0);
  const totalAnts     = workersCount + soldiersCount;

  ControlPanel.updateStats(
    Math.round(state.fpsSmoothed), state.viewZoom, totalAnts,
    state.antDeaths, workersCount, soldiersCount,
    state.spiders.length, state.foods.size, state.measuredPhysicsHz
  );

  accumulator += delta;

  // Compute fixed step from state (Hz) and limit steps per frame from state.
  const fixedStep = 1 / Math.max(1, state.physicsStepHz || 120);
  const maxSteps = Math.max(1, state.maxPhysicsStepsPerFrame || 8);

  // Prevent large backlog when `maxSteps` was previously small: clamp accumulator
  // so we don't run a big catch-up burst when the limit is raised again.
  accumulator = Math.min(accumulator, fixedStep * maxSteps);

  // Run fixed-step physics updates. Limit steps per frame to avoid stalls.
  let steps = 0;
  while (accumulator >= fixedStep && steps < maxSteps) {
    update(fixedStep);
    accumulator -= fixedStep;
    steps++;
    _physStepCounter++;
  }

  // Update measured steps/sec roughly every second
  const nowPhys = performance.now();
  if (nowPhys - _lastPhysTimestamp >= 1000) {
    const measured = Math.round((_physStepCounter * 1000) / (nowPhys - _lastPhysTimestamp));
    state.measuredPhysicsHz = measured;
    _physStepCounter = 0;
    _lastPhysTimestamp = nowPhys;
  }

  // Render once per rAF. We don't require interpolation here.
  if (state.renderMode === '3d') {
    Render3D.render3D();
  } else {
    Render2D.drawBackground();
    Render2D.drawForeground();
    if (state.showMiniMap) Render2D.drawMiniMap();
    if (state.showDebugPaths || state.showEvaluationMap) Render2D.drawDebug();
  }

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

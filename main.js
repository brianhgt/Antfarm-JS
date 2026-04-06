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
import * as Entity from './entities/entity.js';
import { updateSpiders, updateSkulls } from './entities/enemy.js';
import * as AI from './systems/ai.js';
import * as AIPheromone from './systems/aiPheromone.js';
import { spawnFood, spawnFoodClumps, updateEvaluationMaps, updatePheromones } from './systems/physics.js';

const jq = jQuery.noConflict();

const SCENARIO_ID_CUSTOM = 'custom';
const SCENARIO_ID_SOLDIER_VS_SPIDER = 'soldier-vs-spider';
const DEFAULT_SCENARIO_SEED = '1234';
const DEFAULT_FOOD_PILE_RADIUS = 2;
const DEFAULT_FOOD_PILE_SIZE = 14;

// ─── World initialization ──────────────────────────────────────

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeScenarioConfig(input = {}) {
  const scenarioId = input.scenarioId === SCENARIO_ID_SOLDIER_VS_SPIDER
    ? SCENARIO_ID_SOLDIER_VS_SPIDER
    : SCENARIO_ID_CUSTOM;

  const defaultSpiderCount = scenarioId === SCENARIO_ID_SOLDIER_VS_SPIDER ? 1 : 0;
  const seed = String(input.seed ?? '').trim() || state.currentSeed || DEFAULT_SCENARIO_SEED;

  return {
    scenarioId,
    seed,
    colonyCount: clampInt(input.colonyCount, 1, 8, 1),
    antsPerColony: clampInt(input.antsPerColony, 0, 500, scenarioId === SCENARIO_ID_SOLDIER_VS_SPIDER ? 0 : 2),
    soldiersPerColony: clampInt(input.soldiersPerColony, 0, 500, scenarioId === SCENARIO_ID_SOLDIER_VS_SPIDER ? 8 : 0),
    spiderCount: clampInt(input.spiderCount, 0, 20, defaultSpiderCount),
    foodDistance: clampInt(input.foodDistance, 4, Math.min(WORLD_X_MAX, WORLD_Y_MAX) - 4, 60)
  };
}

function resetWorldState() {
  state.viewMap = [];
  state.viewMapDirty.clear();
  state.foodDirty.clear();

  state.colonies = [];
  state.foods = new Map();
  state.spiders = [];
  state.skulls = [];

  state.trailPheromoneMaps = [];
  state.alarmPheromoneMaps = [];
  state.footprintPheromoneMaps = [];
  state.evaluationMaps = [];

  state.spiderScore = 0;
  state.antDeaths = 0;

  state.foodSpawnTimer = state.foodSpawnInterval;
  state.foodClumpSpawnTimer = 0;
}

function createColony(index) {
  return {
    index,
    name: String.fromCharCode(65 + (index % 26)),
    aiType: 'pheromone',
    foragerRatio: 0.5,
    color: 'black',
    pheromoneColors: { trail: '#f7a531', footprint: '#57c7ff', alarm: '#ff4d5a' },
    pheromones: { trail: new Map(), alarm: new Map(), footprint: new Map() },
    evaluationMap: new Map(),
    nest: {}, eggs: new Map(), workers: [], soldiers: [], player: {}, score: 0, playerTarget: null
  };
}

function placeNest(col, colIdx, colonyCount) {
  const span = WORLD_X_MAX - 10;
  const centerX = colonyCount === 1
    ? Math.floor(WORLD_X_MAX / 2)
    : 5 + Math.floor((span / (colonyCount - 1)) * colIdx);
  const jitter = Math.floor(Core.worldRandom() * 9) - 4;
  const nx = Math.max(3, Math.min(WORLD_X_MAX - 4, centerX + jitter));
  const ny = DEFAULT_NEST_Y;
  const nz = 2 + Math.min(Math.floor(Core.worldRandom() * (WORLD_Z_MAX - 4)), NEST_MAX_DEPTH);

  Util.setBlock(nx, ny, nz, TILE.NEST);
  Util.setBlock(nx, ny, nz + 1, TILE.NEST);

  for (let x = nx - 1; x <= nx + 1; x++) {
    for (let z = nz - 1; z <= nz + 2; z++) {
      if (x >= 0 && x < WORLD_X_MAX && z >= 0 && z < WORLD_Z_MAX) {
        if (Util.isTileType(Util.getBlockAt(x, ny, z), TILE.DIRT)) {
          Util.setBlock(x, ny, z, TILE.EMPTY);
        }
      }
    }
  }

  for (let i = 1; i <= 2; i++) {
    Util.setBlock(nx - i, ny, nz + 1, TILE.EMPTY);
    Util.setBlock(nx - i, ny, nz + 2, TILE.EMPTY);
  }

  let xShift = 0;
  for (let z = nz + 2; z > 0; z--) {
    const tunnelX = nx - 2 + xShift;
    Util.setBlock(tunnelX, ny, z, TILE.EMPTY);
    if (Core.worldRandom() < 0.1) {
      xShift += Math.ceil(Core.worldRandom() * 3 - 2);
    }
  }

  col.nest = { x: nx, y: ny, z: nz, sX: nx, sY: ny, sZ: nz + 1 };
  col.player = { x: nx + 0.5, y: ny + 0.5, z: nz + 0.5, carrying: null };
}

function spawnInitialAnts(col, antsPerColony, soldiersPerColony) {
  const spawnAtNest = (type) => {
    const tile = Util.getRandomNearbyEmptyTile(col.nest.x, col.nest.y, col.nest.z, 0, 3) || {
      x: col.nest.x,
      y: col.nest.y,
      z: col.nest.z
    };
    Entity.addNewAnt(col, type, tile.x, tile.y, tile.z);
  };

  for (let i = 0; i < soldiersPerColony; i++) {
    spawnAtNest(ANT_TYPE.SOLDIER);
  }

  for (let i = 0; i < antsPerColony; i++) {
    spawnAtNest(ANT_TYPE.WORKER);
  }
}

function placeFoodPile(foodDistance) {
  const sourceColony = state.colonies[0];
  if (!sourceColony || !sourceColony.nest) return;

  const angle = Core.worldRandom() * Math.PI * 2;
  const centerX = Math.max(1, Math.min(WORLD_X_MAX - 2,
    Math.round(sourceColony.nest.x + Math.cos(angle) * foodDistance)));
  const centerY = Math.max(1, Math.min(WORLD_Y_MAX - 2,
    Math.round(sourceColony.nest.y + Math.sin(angle) * foodDistance)));

  for (let i = 0; i < DEFAULT_FOOD_PILE_SIZE; i++) {
    const fx = Math.max(0, Math.min(WORLD_X_MAX - 1,
      centerX + Math.floor(Core.worldRandom() * (DEFAULT_FOOD_PILE_RADIUS * 2 + 1)) - DEFAULT_FOOD_PILE_RADIUS));
    const fy = Math.max(0, Math.min(WORLD_Y_MAX - 1,
      centerY + Math.floor(Core.worldRandom() * (DEFAULT_FOOD_PILE_RADIUS * 2 + 1)) - DEFAULT_FOOD_PILE_RADIUS));
    const fz = 0;
    const hash = Util.get3dHash(fx, fy, fz);
    state.foods.set(hash, { x: fx, y: fy, z: fz, carry: false });
    state.foodDirty.set(hash, Core.DIRTY_STATE.CREATE);
  }
}

function spawnSpiders(spiderCount) {
  for (let i = 0; i < spiderCount; i++) {
    state.spiders.push({
      x: Math.floor(Core.worldRandom() * WORLD_X_MAX),
      y: Math.floor(Core.worldRandom() * WORLD_Y_MAX),
      z: 0,
      target: null,
      path: null,
      pathIndex: 0,
      timer: EGG_HATCH_TIME,
      cooldownTimer: SPIDER_COOLDOWN
    });
  }
}

export function launchScenario(configInput = {}) {
  const config = normalizeScenarioConfig(configInput);

  Core.reseedRandomGenerators(config.seed);
  resetWorldState();

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

  state.colonies = Array.from({ length: config.colonyCount }, (_, idx) => createColony(idx));

  state.trailPheromoneMaps = state.colonies.map(col => col.pheromones.trail);
  state.alarmPheromoneMaps = state.colonies.map(col => col.pheromones.alarm);
  state.footprintPheromoneMaps = state.colonies.map(col => col.pheromones.footprint);
  state.evaluationMaps = state.colonies.map(col => col.evaluationMap);

  state.colonies.forEach((col, colIdx) => {
    placeNest(col, colIdx, state.colonies.length);
    spawnInitialAnts(col, config.antsPerColony, config.soldiersPerColony);
  });

  placeFoodPile(config.foodDistance);
  spawnSpiders(config.spiderCount);

  state.selectedScenarioId = config.scenarioId;
  state.scenarioAntsPerColony = config.antsPerColony;
  state.scenarioSoldiersPerColony = config.soldiersPerColony;
  state.scenarioColonies = config.colonyCount;
  state.scenarioSpiders = config.spiderCount;
  state.scenarioFoodDistance = config.foodDistance;
  state.numSpiders = config.spiderCount;

  return config;
}

function initWorld() {
  launchScenario({
    scenarioId: SCENARIO_ID_CUSTOM,
    seed: state.currentSeed || DEFAULT_SCENARIO_SEED,
    antsPerColony: 7,
    soldiersPerColony: 0,
    colonyCount: 2,
    spiderCount: state.numSpiders,
    foodDistance: 40
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
  ControlPanel.initControlPanel(jq, launchScenario);

  // Resize handler
  window.addEventListener('resize', () => {
    Render2D.resizeCanvasesToViewport();
    Controls.clampCameraToViewBounds();
    Render2D.drawBackground();
  });

  Render2D.drawBackground();
  requestAnimationFrame(gameLoop);
});

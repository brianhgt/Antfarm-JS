// core.js — Constants and shared mutable game state

// ─── Tile & Entity Constants ───────────────────────────────────

export const TILE = {
  EMPTY: 'EMPTY',
  DIRT: 'DIRT',
  ROCK: 'ROCK',
  WATER: 'WATER',
  NEST: 'NEST',
  FOOD: 'FOOD',
  EGG: 'EGG'
};

export const ANT_TYPE = { QUEEN: 0, WORKER: 1, SOLDIER: 2, FEMALE: 3, MALE: 4 };

export const DEFAULT_TILE_HP = {
  EMPTY: 0,
  DIRT: 30,
  ROCK: 80,
  WATER: 10,
  NEST: 10,
  FOOD: 10,
  EGG: 10
};

// ─── World Dimensions ──────────────────────────────────────────

export const WORLD_X_MAX = 80;
export const WORLD_Y_MAX = 160;
export const WORLD_Z_MAX = 40;
export const TILE_OPEN_SPACE = 1;
export const DEFAULT_NEST_Y = 40;
export const OVERWORLD_Y_RATIO = 20;
export const FOOD_GROUP_SIZE = 20;
export const NEST_MAX_DEPTH = 24;

// ─── Gameplay Tuning ───────────────────────────────────────────

export const EGG_HATCH_TIME = 1000 / 60;   // ~16.7 seconds
export const SPIDER_COOLDOWN = 5;           // seconds between bites
export const FOOD_SPAWN_INTERVAL = 20;      // seconds between food spawns
export const PLAYER_SPEED = 6;
export const ANT_SPEED = 2.4;
export const SPIDER_SPEED = 1.2;
export const PATH_TOLERANCE = 0.08;
export const SPIDER_CAN_GO_BELOW = false;
export const WANDER_DIST = 6;

// Pheromone tuning
export const PHEROMONE_FOOD_RADIUS = 6;
export const PHEROMONE_FOOD_BONUS = 0.35;
export const PHEROMONE_MIN_STRENGTH = 0.01;
export const SPIDER_ALARM_RADIUS = 6;
export const ENEMY_ANT_ALARM_RADIUS = 3;

// ─── Render / Zoom Constants ───────────────────────────────────

export const TILE_SIZE = 20;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.0;
export const ZOOM_STEP = 0.1;

// ─── Mutable runtime state ─────────────────────────────────────
// Every module imports `state` and reads/writes fields directly.
// This single object replaces all window.* assignments and
// jQuery-closure variables from the old codebase.

export const DIRTY_STATE = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE'
};

export const state = {
  // World
  viewMap: [],            // 3D array [x][y][z]
  viewMapDirty: new Map(), // Map keyed by tile hash -> true when tile changed
  foodDirty: new Map(),    // Map keyed by tile hash -> true if food/egg changed

  // Entities
  colonies: [],
  foods: new Map(),
  spiders: [],
  skulls: [],

  //Pheromones
  //Decay is: p(t) = p0 * (1 - decayRate) * t
  //spread = center * (1 - diffusion) + neighbors * (diffusion / numNeighbors)
  trailPheromoneMaps: [], // Array of colony pheromone maps keyed by tile hash -> strength
  trailPheromoneDecay: 0.01, // Amount to decay pheromones each tick
  trailPheromoneDiffusion: 0.02, // Amount to diffuse pheromones each tick
  trailPheromoneDeposit: 1.0, // Initial deposit amount of pheromones when placed

  alarmPheromoneMaps: [], // Array of colony pheromone maps keyed by tile hash -> strength
  alarmPheromoneDecay: 0.3, // Amount to decay pheromones each tick
  alarmPheromoneDiffusion: 0.25, // Amount to diffuse pheromones each tick
  alarmPheromoneDeposit: 5.0, // Initial deposit amount of pheromones when placed

  footprintPheromoneMaps: [], // Array of colony pheromone maps keyed by tile hash -> strength
  footprintPheromoneDecay: 0.2, // Amount to decay pheromones each tick
  footprintPheromoneDiffusion: 0.0, // Amount to diffuse pheromones each tick
  footprintPheromoneDeposit: 0.2, // Initial deposit amount of pheromones when placed

  // Counters
  spiderScore: 0,
  antDeaths: 0,

  // Config (adjustable via control panel)
  maxEntities: 2000,
  numSpiders: 1,
  foodSpawnAmount: 0,
  foodSpawnInterval: FOOD_SPAWN_INTERVAL,
  foodSpawnTimer: FOOD_SPAWN_INTERVAL,
  foodClumpSpawnAmount: 1,
  foodClumpSpawnInterval: 200,
  foodClumpSpawnTimer: 0,
  foodClumpSize: FOOD_GROUP_SIZE,
  foodClumpRadius: 3,

  // View / Camera
  currentView: 'nest',    // 'nest' | 'overworld'
  renderMode: '2d',        // '2d' | '3d'
  currentNestIndex: 0,
  camera1X: 0,
  camera1Y: 0,
  viewZoom: 0.7,
  showDebugPaths: false,
  showMiniMap: false,
  showTrailPheromones: true,
  showAlarmPheromones: true,
  showFootprintPheromones: true,

  // Input
  keys: {},
  suppressNextClick: false,

  // Stats
  fpsSmoothed: 60,

  // Physics / simulation timing (adjustable via control panel)
  physicsStepHz: 120, // simulation ticks per second
  maxPhysicsStepsPerFrame: 8, // safety limit of physics steps per rAF
  // Measured physics steps per second (updated at ~1s intervals)
  measuredPhysicsHz: 0,

  // DOM references (set during initCanvases)
  viewportPanel: null,
  bgCanvas: null,
  fgCanvas: null,
  dbgCanvas: null,
  bgCtx: null,
  fgCtx: null,
  dbgCtx: null,
  canvasWidth: 0,
  canvasHeight: 0,
  COLS: 0,
  ROWS: 0,
};

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
export const FOOD_GROUP_SIZE = 5;
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

// ─── Render / Zoom Constants ───────────────────────────────────

export const TILE_SIZE = 20;
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.0;
export const ZOOM_STEP = 0.1;

// ─── Mutable runtime state ─────────────────────────────────────
// Every module imports `state` and reads/writes fields directly.
// This single object replaces all window.* assignments and
// jQuery-closure variables from the old codebase.

export const state = {
  // World
  viewMap: [],            // 3D array [x][y][z]

  // Entities
  colonies: [],
  foods: new Map(),
  spiders: [],
  skulls: [],

  // Counters
  spiderScore: 0,
  antDeaths: 0,

  // Config (adjustable via control panel)
  maxEntities: 2000,
  numSpiders: 1,
  foodSpawnAmount: 5,
  foodSpawnInterval: FOOD_SPAWN_INTERVAL,
  foodSpawnTimer: FOOD_SPAWN_INTERVAL,

  // View / Camera
  currentView: 'nest',    // 'nest' | 'overworld'
  currentNestIndex: 0,
  camera1X: 0,
  camera1Y: 0,
  viewZoom: 1,
  showDebugPaths: false,

  // Input
  keys: {},
  suppressNextClick: false,

  // Stats
  fpsSmoothed: 60,

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

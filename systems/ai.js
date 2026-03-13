// systems/ai.js — Worker AI, soldier AI, egg hatching

import {
  TILE, ANT_TYPE, ANT_SPEED, PATH_TOLERANCE, WANDER_DIST,
  EGG_HATCH_TIME, state, DIRTY_STATE
} from '../core.js';
import {
  tileType, isSolidTile, isDiggableTile, getBlockAt, setBlock,
  get3dHash, getRandMap, findPath, getRandomNearbyEmptyTile, isValidBlock,
  isMoveOutsideWorld
} from '../util/util.js';
import { damageTileAt, depositAlarmPheromoneIfThreatened, depositPheromone } from './physics.js';
import * as Entity from '../entities/entity.js';

// ─── Entity counting ──────────────────────────────────────────

export function countTotalEntities() {
  let total = 0;
  state.colonies.forEach(col => {
    const eggCount = col.eggs instanceof Map ? col.eggs.size
                   : (Array.isArray(col.eggs) ? col.eggs.length : 0);
    total += col.workers.length + col.soldiers.length + eggCount;
  });
  total += state.spiders.length;
  return total;
}

// ─── Egg spawning ─────────────────────────────────────────────

export function spawnEggNearNest(col, type = ANT_TYPE.WORKER) {
  const angle = Math.random() * Math.PI * 2;
  const ex = col.nest.x + Math.floor(Math.cos(angle) * 2);
  const ez = col.nest.z + Math.floor(Math.sin(angle) * 2);
  const ey = col.nest.y;
  if (isValidBlock(ex, ey, ez) &&
      (tileType(getBlockAt(ex, ey, ez)) === TILE.DIRT ||
       tileType(getBlockAt(ex, ey, ez)) === TILE.EMPTY)) {
    if (countTotalEntities() >= state.maxEntities) return;
    setBlock(ex, ey, ez, TILE.EMPTY);
    const eggHash = get3dHash(ex, ey, ez);
    state.foodDirty.set(eggHash, DIRTY_STATE.CREATE);
    const egg = { x: ex, y: ey, z: ez, type, timer: EGG_HATCH_TIME, carry: false };
    if (col.eggs instanceof Map) {
      col.eggs.set(get3dHash(ex, ey, ez), egg);
    } else if (Array.isArray(col.eggs)) {
      col.eggs.push(egg);
    }
  }
}

export function getNearestSoldier(s) {
  let nearest = null;
  let minDist = Infinity;
  state.colonies.forEach(col => {
    col.soldiers.forEach(sol => {
      const dist = Math.abs(sol.x - s.x) + Math.abs(sol.y - s.y) + Math.abs(sol.z - s.z);
      if (dist < minDist) { minDist = dist; nearest = sol; }
    });
  });
  return nearest;
}

// ─── Egg hatching ─────────────────────────────────────────────

export function hatchEggs(col, idx, delta) {
  const keysToDelete = [];
  col.eggs.forEach((egg, key) => {
    if (!egg) return;
    egg.timer -= delta;
    if (egg.timer <= 0) {
      Entity.addNewAnt(col, egg.type, egg.x, egg.y, egg.z);
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach(key => col.eggs.delete(key));
  keysToDelete.forEach(key => {
    if (typeof key === 'string') {
      state.foodDirty.set(key, DIRTY_STATE.DELETE);
    }
  });
}

// ─── Worker AI ────────────────────────────────────────────────

function updateWorkerPheromoneTrail(ant, colonyIndex) {
  const antX = Math.floor(ant.x);
  const antY = Math.floor(ant.y);
  const antZ = Math.floor(ant.z);
  const currentTileKey = get3dHash(antX, antY, antZ);

  if (ant.lastPheromoneTile === currentTileKey) return;
  ant.lastPheromoneTile = currentTileKey;

  if (ant.carrying === TILE.FOOD) {
    depositPheromone('trail', colonyIndex, antX, antY, antZ);
    return;
  }

  if (!ant.carrying) {
    depositPheromone('footprint', colonyIndex, antX, antY, antZ);
  }
}

function updateAlarmPheromone(entity, colonyIndex) {
  const antX = Math.floor(entity.x);
  const antY = Math.floor(entity.y);
  const antZ = Math.floor(entity.z);
  const currentTileKey = get3dHash(antX, antY, antZ);

  if (entity.lastAlarmPheromoneTile === currentTileKey) return;
  if (depositAlarmPheromoneIfThreatened(colonyIndex, antX, antY, antZ)) {
    entity.lastAlarmPheromoneTile = currentTileKey;
  }
}

export function updateWorkers(col, colonyIndex, delta) {
  col.workers.forEach(ant => {
    if (!ant.path) {
      if (state.foods.size > 0) {
        const target = getRandMap(state.foods);
        ant.target = target;
        ant.path = findPath(
          Math.floor(ant.x), Math.floor(ant.y), Math.floor(ant.z),
          Math.floor(target.x), Math.floor(target.y), Math.floor(target.z),
          PATH_TOLERANCE
        );
        ant.pathIndex = 0;
        if (!ant.path && isSolidTile(getBlockAt(
              Math.floor(target.x), Math.floor(target.y), Math.floor(target.z)))) {
            const targetHash = get3dHash(
              Math.floor(target.x), Math.floor(target.y), Math.floor(target.z)
            );
            state.foods.delete(targetHash);
            state.foodDirty.set(targetHash, DIRTY_STATE.DELETE);
        }
      } else {
        const wander = getRandomNearbyEmptyTile(
          Math.floor(ant.x), Math.floor(ant.y), Math.floor(ant.z), WANDER_DIST
        );
        if (wander) {
          ant.target = wander;
          ant.path = findPath(
            Math.floor(ant.x), Math.floor(ant.y), Math.floor(ant.z),
            wander.x, wander.y, wander.z,
            PATH_TOLERANCE * 2.0
          );
          ant.pathIndex = 0;
        }
      }
    }

    // Move along path
    if (ant.path && ant.pathIndex < ant.path.length) {
      const next = ant.path[ant.pathIndex];
      const dx = next.x + 0.5 - ant.x;
      const dy = next.y + 0.5 - ant.y;
      const dz = next.z + 0.5 - ant.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 0.1) {
        ant.x = next.x + 0.5;
        ant.y = next.y + 0.5;
        ant.z = next.z + 0.5;
        ant.pathIndex++;
      } else {
        const speed = ANT_SPEED * delta;
        const nx = ant.x + speed * dx / len;
        const ny = ant.y + speed * dy / len;
        const nz = ant.z + speed * dz / len;
        if (!isMoveOutsideWorld(nx, ny, nz)) {
          ant.x = nx; ant.y = ny; ant.z = nz;
        }
      }
    } else {
      ant.path = null;
    }

    const antX = Math.floor(ant.x);
    const antY = Math.floor(ant.y);
    const antZ = Math.floor(ant.z);

    updateWorkerPheromoneTrail(ant, colonyIndex);
    updateAlarmPheromone(ant, colonyIndex);

    // Dig
    if (isDiggableTile(getBlockAt(antX, antY, antZ))) {
      damageTileAt(antX, antY, antZ, 10);
    }

    // Pick up food
    const foodKey = get3dHash(antX, antY, antZ);
    if (!ant.carrying && state.foods.has(foodKey)) {
      if (pickupFood(ant, foodKey)) {
        ant.target = { x: col.nest.x, y: col.nest.y, z: col.nest.z };
        ant.path = findPath(antX, antY, antZ, col.nest.x, col.nest.y, col.nest.z, PATH_TOLERANCE);
        ant.pathIndex = 0;
      }
    }

    // Deliver food to nest
    if (ant.carrying === TILE.FOOD &&
        antX === col.nest.x && antY === col.nest.y && antZ === col.nest.z) {
      col.score++;
      ant.carrying = null;
      ant.target = null;
      ant.path = null;
      spawnEggNearNest(col, ANT_TYPE.WORKER);
    }
  });
}

// ─── Soldier AI ───────────────────────────────────────────────

export function updateSoldiers(col, colonyIndex, delta) {
  col.soldiers.forEach(ant => {
    if (!ant.path) {
      const wander = getRandomNearbyEmptyTile(
        Math.floor(ant.x), Math.floor(ant.y), Math.floor(ant.z), 5
      );
      if (wander) {
        ant.target = wander;
        ant.path = findPath(
          Math.floor(ant.x), Math.floor(ant.y), Math.floor(ant.z),
          wander.x, wander.y, wander.z,
          PATH_TOLERANCE * 2.0
        );
        ant.pathIndex = 0;
      }
    }

    // Move along path
    if (ant.path && ant.pathIndex < ant.path.length) {
      const next = ant.path[ant.pathIndex];
      const dx = next.x + 0.5 - ant.x;
      const dy = next.y + 0.5 - ant.y;
      const dz = next.z + 0.5 - ant.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 0.1) {
        ant.x = next.x + 0.5;
        ant.y = next.y + 0.5;
        ant.z = next.z + 0.5;
        ant.pathIndex++;
      } else {
        const speed = ANT_SPEED * delta;
        const nx = ant.x + speed * dx / len;
        const ny = ant.y + speed * dy / len;
        const nz = ant.z + speed * dz / len;
        if (!isMoveOutsideWorld(nx, ny, nz)) {
          ant.x = nx; ant.y = ny; ant.z = nz;
        }
      }
    } else {
      ant.path = null;
    }

    const antX = Math.floor(ant.x);
    const antY = Math.floor(ant.y);
    const antZ = Math.floor(ant.z);

    updateAlarmPheromone(ant, colonyIndex);

    // Dig
    if (isDiggableTile(getBlockAt(antX, antY, antZ))) {
      damageTileAt(antX, antY, antZ, 10);
    }

    // Attack spiders
    state.spiders.forEach(s => {
      if (Math.abs(ant.x - s.x) < 0.7 &&
          Math.abs(ant.y - s.y) < 0.7 &&
          Math.abs(ant.z - s.z) < 0.7) {
        state.skulls.push({ x: s.x, y: s.y, z: s.z, timer: 300 });
        s.timer = EGG_HATCH_TIME;
      }
    });
  });
}

// systems/physics.js — Tile damage, food spawning, and pheromones

import * as Core from '../core.js';
import {
  isDiggableTile, isSolidTile, getBlockAt, setBlock, get3dHash, getBlockLocationAtKey, isValidBlock
} from '../util/util.js';

const PHEROMONE_CONFIG = {
  trail: {
    mapsKey: 'trailPheromoneMaps',
    colonyTypeKey: 'trail',
    decayKey: 'trailPheromoneDecay',
    diffusionKey: 'trailPheromoneDiffusion',
    depositKey: 'trailPheromoneDeposit'
  },
  alarm: {
    mapsKey: 'alarmPheromoneMaps',
    colonyTypeKey: 'alarm',
    decayKey: 'alarmPheromoneDecay',
    diffusionKey: 'alarmPheromoneDiffusion',
    depositKey: 'alarmPheromoneDeposit'
  },
  footprint: {
    mapsKey: 'footprintPheromoneMaps',
    colonyTypeKey: 'footprint',
    decayKey: 'footprintPheromoneDecay',
    diffusionKey: 'footprintPheromoneDiffusion',
    depositKey: 'footprintPheromoneDeposit'
  }
};

const PHEROMONE_DIRS = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { x: 0, y: 0, z: 1 },
  { x: 0, y: 0, z: -1 }
];

export function damageTileAt(x, y, z, amount = 10) {
  const tile = getBlockAt(x, y, z);
  if (!isDiggableTile(tile)) return Infinity;
  const nextHp = (tile.hp ?? 0) - amount;
  if (nextHp <= 0) {
    setBlock(x, y, z, Core.TILE.EMPTY);
    Core.state.viewMapDirty.set(get3dHash(x, y, z), Core.DIRTY_STATE.DELETE);
    return 0;
  }
  setBlock(x, y, z, { type: tile.type, hp: nextHp });
  return nextHp;
}

export function damageAnt(attacker, defender) {


}

export function pickupFood(ant, foodKey) {
  const food = Core.state.foods.get(foodKey);
  if (!food) return false;
  Core.state.foods.delete(foodKey);
  Core.state.foodDirty.set(foodKey, Core.DIRTY_STATE.DELETE);
  ant.carrying = Core.TILE.FOOD;
  return true;
}

export function pickupFoodAt(ant, foodX, foodY, foodZ) {
  const foodKey = get3dHash(foodX, foodY, foodZ);
  return pickupFood(ant, foodKey);
}

export function dropFood(ant, foodKey) {
  if (!ant.carrying) return false;
  const food = { x: ant.x, y: ant.y, z: ant.z, carry: false };
  Core.state.foods.set(foodKey, food);
  Core.state.foodDirty.set(foodKey, Core.DIRTY_STATE.CREATE);
}

export function spawnFoodAt(x, y, z = 0) {
  if (!isValidBlock(x, y, z) || isSolidTile(getBlockAt(x, y, z))) return false;
  const key = get3dHash(x, y, z);
  if (Core.state.foods.has(key)) return false;

  Core.state.foods.set(key, { x, y, z, carry: false });
  Core.state.foodDirty.set(key, Core.DIRTY_STATE.CREATE);
  return true;
}

export function spawnFood(delta) {
  Core.state.foodSpawnTimer -= delta;
  if (Core.state.foodSpawnTimer <= 0) {
    Core.state.foodSpawnTimer = Core.state.foodSpawnInterval;
    for (let i = 0; i < Core.state.foodSpawnAmount; i++) {
      const fx = Math.floor(Core.random() * Core.WORLD_X_MAX);
      const fy = Math.floor(Core.random() * Core.WORLD_Y_MAX);
      const fz = 0;
      spawnFoodAt(fx, fy, fz);
    }
    // overall spawn will have already marked individual tiles dirty
  }
}

function spawnFoodClump(centerX, centerY, centerZ = 0) {
  let spawned = 0;
  const size = Math.max(1, Core.state.foodClumpSize ?? Core.FOOD_GROUP_SIZE);
  const radius = Math.max(1, Core.state.foodClumpRadius ?? 3);

  spawned += spawnFoodAt(centerX, centerY, centerZ) ? 1 : 0;

  let attempts = 0;
  while (spawned < size && attempts < size * 12) {
    const fx = centerX + Math.floor(Core.random() * (radius * 2 + 1)) - radius;
    const fy = centerY + Math.floor(Core.random() * (radius * 2 + 1)) - radius;
    spawned += spawnFoodAt(fx, fy, centerZ) ? 1 : 0;
    attempts++;
  }
}

export function spawnFoodClumps(delta) {
  Core.state.foodClumpSpawnTimer -= delta;
  if (Core.state.foodClumpSpawnTimer > 0) return;

  Core.state.foodClumpSpawnTimer = Core.state.foodClumpSpawnInterval;
  const clumpCount = Math.max(1, Core.state.foodClumpSpawnAmount ?? 1);

  for (let i = 0; i < clumpCount; i++) {
    const fx = Math.floor(Core.random() * Core.WORLD_X_MAX);
    const fy = Math.floor(Core.random() * Core.WORLD_Y_MAX);
    spawnFoodClump(fx, fy, 0);
  }
}

function getPheromoneConfig(type) {
  return PHEROMONE_CONFIG[type] ?? null;
}

function getColonyPheromoneMap(colonyIndex, type) {
  const config = getPheromoneConfig(type);
  const colony = Core.state.colonies[colonyIndex];
  if (!config || !colony) return null;

  if (!colony.pheromones) colony.pheromones = {};
  if (!(colony.pheromones[config.colonyTypeKey] instanceof Map)) {
    colony.pheromones[config.colonyTypeKey] = new Map();
  }

  if (!Array.isArray(Core.state[config.mapsKey])) {
    Core.state[config.mapsKey] = [];
  }
  Core.state[config.mapsKey][colonyIndex] = colony.pheromones[config.colonyTypeKey];
  return colony.pheromones[config.colonyTypeKey];
}

function getColonyEvaluationMap(colonyIndex) {
  const colony = Core.state.colonies[colonyIndex];
  if (!colony) return null;

  if (!(colony.evaluationMap instanceof Map)) {
    colony.evaluationMap = new Map();
  }

  if (!Array.isArray(Core.state.evaluationMaps)) {
    Core.state.evaluationMaps = [];
  }
  Core.state.evaluationMaps[colonyIndex] = colony.evaluationMap;
  return colony.evaluationMap;
}

function getFoodCountInRadius(x, y, z, radius = Core.PHEROMONE_FOOD_RADIUS) {
  const radiusSq = radius * radius;
  let count = 0;
  Core.state.foods.forEach(food => {
    const dx = food.x - x;
    const dy = food.y - y;
    const dz = food.z - z;
    if ((dx * dx) + (dy * dy) + (dz * dz) <= radiusSq) {
      count++;
    }
  });
  return count;
}

function getFoodStrengthMultiplier(x, y, z) {
  const nearbyFoodCount = getFoodCountInRadius(x, y, z);
  return 1 + (nearbyFoodCount * Core.PHEROMONE_FOOD_BONUS);
}

function addPheromoneValue(map, key, amount) {
  if (amount <= 0) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

function getDiffuseTargets(x, y, z) {
  const targets = [];
  for (const dir of PHEROMONE_DIRS) {
    const nx = x + dir.x;
    const ny = y + dir.y;
    const nz = z + dir.z;
    if (!isValidBlock(nx, ny, nz)) continue;
    if (isSolidTile(getBlockAt(nx, ny, nz))) continue;
    targets.push({ x: nx, y: ny, z: nz, key: get3dHash(nx, ny, nz) });
  }
  return targets;
}

function updatePheromoneMap(sourceMap, decayKey, diffusionKey, delta) {
  if (!(sourceMap instanceof Map) || sourceMap.size === 0) return;

  const tickScale = Math.max(0, delta );
  //const decay = Math.min(1, Core.state[decayKey] * tickScale);
  const decay = Core.state[decayKey] * tickScale;
  //const diffusion = Math.min(1, Core.state[diffusionKey] * tickScale);
  const diffusion = Core.state[diffusionKey] * tickScale;
  const nextMap = new Map();

  sourceMap.forEach((strength, key) => {
    // Early exit if already too weak
    if (strength <= Core.PHEROMONE_MIN_STRENGTH) return;

    const [x, y, z] = key.split(',').map(Number);
    if (!isValidBlock(x, y, z)) return;
    if (isSolidTile(getBlockAt(x, y, z))) return;

    const afterDecay = strength * (1 - decay);
    // Early exit if decayed too much
    if (afterDecay <= Core.PHEROMONE_MIN_STRENGTH) return;

    const diffuseTargets = getDiffuseTargets(x, y, z);
    if (diffuseTargets.length === 0 || diffusion <= 0) {
      addPheromoneValue(nextMap, key, afterDecay);
      return;
    }

    const retained = afterDecay * (1 - diffusion);
    const spread = afterDecay - retained;
    addPheromoneValue(nextMap, key, retained);

    const amountPerTarget = spread / diffuseTargets.length;
    diffuseTargets.forEach(target => addPheromoneValue(nextMap, target.key, amountPerTarget));
  });

  sourceMap.clear();
  Array.from(nextMap.entries())
    .filter(([, value]) => value > Core.PHEROMONE_MIN_STRENGTH)
    .forEach(([key, value]) => sourceMap.set(key, value));
}

export function depositPheromone(type, colonyIndex, x, y, z, multiplier = 1) {
  const config = getPheromoneConfig(type);
  if (!config) return 0;
  if (!isValidBlock(x, y, z) || isSolidTile(getBlockAt(x, y, z))) return 0;

  const strength = Core.state[config.depositKey] * multiplier * getFoodStrengthMultiplier(x, y, z);
  const key = get3dHash(x, y, z);
  const pheromoneMap = getColonyPheromoneMap(colonyIndex, type);
  if (!(pheromoneMap instanceof Map)) return 0;
  pheromoneMap.set(key, (pheromoneMap.get(key) ?? 0) + strength);
  return strength;
}

export function recordTileEvaluation(colonyIndex, x, y, z, value, decayTime = Core.state.evaluationMapDecayTime) {
  if (!Number.isFinite(value)) return null;
  if (!isValidBlock(x, y, z) || isSolidTile(getBlockAt(x, y, z))) return null;

  const evaluationMap = getColonyEvaluationMap(colonyIndex);
  if (!(evaluationMap instanceof Map)) return null;

  const lifetime = Math.max(0, decayTime || 0);
  const entry = {
    value,
    decayTime: lifetime,
    maxDecayTime: lifetime
  };

  evaluationMap.set(get3dHash(x, y, z), entry);
  return entry;
}

export function isEnemyAntNearby(colonyIndex, x, y, z, radius = Core.ENEMY_ANT_ALARM_RADIUS) {
  const radiusSq = radius * radius;

  for (let i = 0; i < Core.state.colonies.length; i++) {
    if (i === colonyIndex) continue;
    const colony = Core.state.colonies[i];
    const ants = [colony.player, ...colony.workers, ...colony.soldiers];

    for (const ant of ants) {
      if (!ant) continue;
      const dx = ant.x - x;
      const dy = ant.y - y;
      const dz = ant.z - z;
      if ((dx * dx) + (dy * dy) + (dz * dz) <= radiusSq) {
        return true;
      }
    }
  }

  return false;
}

export function isSpiderNearby(x, y, z, radius = Core.SPIDER_ALARM_RADIUS) {
  const radiusSq = radius * radius;
  return Core.state.spiders.some(spider => {
    if (!spider || spider.timer > 0) return false;
    const dx = spider.x - x;
    const dy = spider.y - y;
    const dz = spider.z - z;
    return (dx * dx) + (dy * dy) + (dz * dz) <= radiusSq;
  });
}

export function isThreatened(colonyIndex, x, y, z) {
  return isEnemyAntNearby(colonyIndex, x, y, z) || isSpiderNearby(x, y, z);
}

export function depositAlarmPheromoneIfThreatened(colonyIndex, x, y, z, multiplier = 1) {
  if (!isThreatened(colonyIndex, x, y, z)) {
    return false;
  }

  depositPheromone('alarm', colonyIndex, x, y, z, multiplier);
  return true;
}

export function updatePheromones(delta) {
  Object.values(PHEROMONE_CONFIG).forEach(config => {
    Core.state.colonies.forEach((_, colonyIndex) => {
      const pheromoneMap = getColonyPheromoneMap(colonyIndex, config.colonyTypeKey);
      updatePheromoneMap(pheromoneMap, config.decayKey, config.diffusionKey, delta);
    });
  });
}

export function updateEvaluationMaps(delta) {
  const tickScale = Math.max(0, delta);
  if (tickScale <= 0) return;

  Core.state.colonies.forEach((_, colonyIndex) => {
    const evaluationMap = getColonyEvaluationMap(colonyIndex);
    if (!(evaluationMap instanceof Map) || evaluationMap.size === 0) return;

    evaluationMap.forEach((entry, key) => {
      const { x, y, z } = getBlockLocationAtKey(key);
      if (!entry || !Number.isFinite(entry.value) || !isValidBlock(x, y, z) || isSolidTile(getBlockAt(x, y, z))) {
        evaluationMap.delete(key);
        return;
      }

      entry.decayTime = Math.max(0, (entry.decayTime ?? 0) - tickScale);
      if (entry.decayTime <= 0) {
        evaluationMap.delete(key);
      }
    });
  });
}

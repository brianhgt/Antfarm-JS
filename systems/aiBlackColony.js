// systems/aiBlackColony.js — Pheromone-led worker AI for the black colony

import {
  TILE, ANT_TYPE, ANT_SPEED, PATH_TOLERANCE, WANDER_DIST,
  EGG_HATCH_TIME, state, DIRTY_STATE
} from '../core.js';
import {
  isSolidTile, isDiggableTile, getBlockAt,
  get3dHash, findPath, getRandomNearbyEmptyTile, isMoveOutsideWorld
} from '../util.js';
import { damageTileAt, depositAlarmPheromoneIfThreatened, depositPheromone } from './physics.js';

function getPheromoneValue(map, x, y, z) {
  if (!(map instanceof Map)) return 0;
  return map.get(get3dHash(x, y, z)) ?? 0;
}

function getNestDistance(col, x, y, z) {
  const dx = x - col.nest.x;
  const dy = y - col.nest.y;
  const dz = z - col.nest.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function ensureWorkerRole(ant, col) {
  if (ant.role) return;
  ant.role = Math.random() < (col.foragerRatio ?? 0.25) ? 'forager' : 'worker';
}

function setPathToTarget(ant, target, tolerance = PATH_TOLERANCE) {
  if (!target) return false;
  const path = findPath(
    Math.floor(ant.x), Math.floor(ant.y), Math.floor(ant.z),
    Math.floor(target.x), Math.floor(target.y), Math.floor(target.z),
    tolerance
  );
  if (!path || path.length === 0) return false;
  ant.target = target;
  ant.path = path;
  ant.pathIndex = 0;
  return true;
}

function moveAlongPath(ant, delta) {
  if (!ant.path || ant.pathIndex >= ant.path.length) {
    ant.path = null;
    return;
  }

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
    return;
  }

  const speed = ANT_SPEED * delta;
  const nx = ant.x + speed * dx / len;
  const ny = ant.y + speed * dy / len;
  const nz = ant.z + speed * dz / len;
  if (!isMoveOutsideWorld(nx, ny, nz)) {
    ant.x = nx;
    ant.y = ny;
    ant.z = nz;
  }
}

function updateWorkerPheromoneTrail(ant, colonyIndex) {
  const antX = Math.floor(ant.x);
  const antY = Math.floor(ant.y);
  const antZ = Math.floor(ant.z);
  const currentTileKey = get3dHash(antX, antY, antZ);

  if (ant.lastPheromoneTile === currentTileKey) return;
  ant.lastPheromoneTile = currentTileKey;

  if (ant.carrying === TILE.FOOD) {
    depositPheromone('trail', colonyIndex, antX, antY, antZ, ant.role === 'forager' ? 1.5 : 1);
    return;
  }

  depositPheromone('footprint', colonyIndex, antX, antY, antZ, ant.role === 'worker' ? 1.2 : 0.75);
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

function findNearestFood(ant, maxDistance = Infinity) {
  let best = null;
  let bestDist = maxDistance;

  state.foods.forEach(food => {
    const dx = food.x - ant.x;
    const dy = food.y - ant.y;
    const dz = food.z - ant.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < bestDist) {
      best = food;
      bestDist = dist;
    }
  });

  return best;
}

function getWorkerCrowding(col, ant, x, y, z, radius = 3) {
  const radiusSq = radius * radius;
  let crowding = 0;

  col.workers.forEach(other => {
    if (!other || other === ant) return;
    const dx = other.x - x;
    const dy = other.y - y;
    const dz = other.z - z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > radiusSq) return;

    // Nearby ants count more heavily than ants near the edge of the sample radius.
    crowding += 1 - (distSq / radiusSq);
  });

  return crowding;
}

function chooseRecruitmentTarget(col, ant) {
  if (ant.role !== 'worker') return null;

  const currentX = Math.floor(ant.x);
  const currentY = Math.floor(ant.y);
  const currentZ = Math.floor(ant.z);
  const trailMap = col.pheromones?.trail;
  const alarmMap = col.pheromones?.alarm;
  let bestTarget = null;
  let bestScore = 0.9;

  for (let i = 0; i < 24; i++) {
    const candidate = getRandomNearbyEmptyTile(currentX, currentY, currentZ, 9);
    if (!candidate) continue;

    const trail = getPheromoneValue(trailMap, candidate.x, candidate.y, candidate.z);
    if (trail <= 0) continue;

    const alarm = getPheromoneValue(alarmMap, candidate.x, candidate.y, candidate.z);
    const nestDist = getNestDistance(col, candidate.x, candidate.y, candidate.z);
    const crowding = getWorkerCrowding(col, ant, candidate.x + 0.5, candidate.y + 0.5, candidate.z + 0.5);
    const score = (trail * 5.5)
      - (alarm * 5.0)
      - (crowding * 3.2)
      + (Math.min(nestDist, 14) * 0.25);

    if (score > bestScore) {
      bestScore = score;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}

function chooseScoredTarget(col, ant) {
  const currentX = Math.floor(ant.x);
  const currentY = Math.floor(ant.y);
  const currentZ = Math.floor(ant.z);
  const footprintMap = col.pheromones?.footprint;
  const trailMap = col.pheromones?.trail;
  const alarmMap = col.pheromones?.alarm;
  const radius = ant.role === 'forager' ? 12 : Math.max(6, Math.floor(WANDER_DIST * 1.25));
  const samples = ant.role === 'forager' ? 28 : 22;

  let bestTarget = null;
  let bestScore = -Infinity;

  for (let i = 0; i < samples; i++) {
    const candidate = getRandomNearbyEmptyTile(currentX, currentY, currentZ, radius);
    if (!candidate) continue;

    const footprint = getPheromoneValue(footprintMap, candidate.x, candidate.y, candidate.z);
    const trail = getPheromoneValue(trailMap, candidate.x, candidate.y, candidate.z);
    const alarm = getPheromoneValue(alarmMap, candidate.x, candidate.y, candidate.z);
    const nestDist = getNestDistance(col, candidate.x, candidate.y, candidate.z);
    const stepDist = Math.abs(candidate.x - currentX) + Math.abs(candidate.y - currentY) + Math.abs(candidate.z - currentZ);
    const surfaceBias = col.nest.z - candidate.z;
    const crowding = getWorkerCrowding(col, ant, candidate.x + 0.5, candidate.y + 0.5, candidate.z + 0.5);

    let score;
    if (ant.role === 'forager') {
      score = (trail * 4.5)
        - (footprint * 0.7)
        - (alarm * 3.5)
        - (crowding * 1.4)
        + (Math.min(nestDist, 26) * 0.22)
        + (surfaceBias * 0.9)
        - (stepDist * 0.12);
    } else {
      const desiredNestDist = 6.5;
      score = (footprint * 2.4)
        + (trail * 3.4)
        - (alarm * 4.0)
        - (crowding * 3.8)
        - (Math.max(0, footprint - 0.8) * 1.8)
        + (Math.min(trail, 2.5) * Math.min(nestDist, 12) * 0.18)
        - (Math.abs(nestDist - desiredNestDist) * 0.7)
        - (Math.max(0, nestDist - 12) * 1.6)
        - (stepDist * 0.04);
    }

    if (score > bestScore) {
      bestScore = score;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}

function chooseIdleTarget(col, ant) {
  if (ant.carrying === TILE.FOOD) {
    return { x: col.nest.x, y: col.nest.y, z: col.nest.z };
  }

  const food = findNearestFood(ant, ant.role === 'forager' ? 30 : 10);
  if (food && setPathToTarget(ant, food, PATH_TOLERANCE)) {
    return true;
  }

  const recruitmentTarget = chooseRecruitmentTarget(col, ant);
  if (recruitmentTarget && setPathToTarget(ant, recruitmentTarget, PATH_TOLERANCE * 1.3)) {
    return true;
  }

  const nestDist = getNestDistance(col, ant.x, ant.y, ant.z);
  if (ant.role !== 'forager' && nestDist > 12) {
    return setPathToTarget(ant, col.nest, PATH_TOLERANCE);
  }

  const target = chooseScoredTarget(col, ant) || getRandomNearbyEmptyTile(
    Math.floor(ant.x), Math.floor(ant.y), Math.floor(ant.z), ant.role === 'forager' ? 10 : 6
  );
  return setPathToTarget(ant, target, PATH_TOLERANCE * (ant.role === 'forager' ? 1.4 : 2.0));
}

function handleFoodInteractions(col, ant, antX, antY, antZ) {
  const tileHash = get3dHash(antX, antY, antZ);

  if (!ant.carrying && state.foods.has(tileHash)) {
    ant.carrying = TILE.FOOD;
    state.foods.delete(tileHash);
    state.foodDirty.set(tileHash, DIRTY_STATE.DELETE);
    setPathToTarget(ant, col.nest, PATH_TOLERANCE);
    return;
  }

  if (ant.carrying === TILE.FOOD &&
      antX === col.nest.x && antY === col.nest.y && antZ === col.nest.z) {
    col.score++;
    ant.carrying = null;
    ant.target = null;
    ant.path = null;
    ant.lastPheromoneTile = null;
    ant.lastAlarmPheromoneTile = null;
    const eggType = Math.random() < 0.2 ? ANT_TYPE.SOLDIER : ANT_TYPE.WORKER;
    const angle = Math.random() * Math.PI * 2;
    const ex = col.nest.x + Math.floor(Math.cos(angle) * 2);
    const ez = col.nest.z + Math.floor(Math.sin(angle) * 2);
    const ey = col.nest.y;
    if (state.colonies[col.index]) {
      const eggHash = get3dHash(ex, ey, ez);
      if (!isSolidTile(getBlockAt(ex, ey, ez))) {
        col.eggs.set(eggHash, { x: ex, y: ey, z: ez, type: eggType, timer: EGG_HATCH_TIME, carry: false });
        state.foodDirty.set(eggHash, DIRTY_STATE.CREATE);
      }
    }
  }
}

export function updateWorkers(col, colonyIndex, delta) {
  col.workers.forEach(ant => {
    ensureWorkerRole(ant, col);

    if (!ant.path) {
      chooseIdleTarget(col, ant);
    }

    moveAlongPath(ant, delta);

    if (ant.path && ant.pathIndex >= ant.path.length) {
      ant.path = null;
      ant.target = null;
    }

    const antX = Math.floor(ant.x);
    const antY = Math.floor(ant.y);
    const antZ = Math.floor(ant.z);

    updateWorkerPheromoneTrail(ant, colonyIndex);
    updateAlarmPheromone(ant, colonyIndex);

    if (isDiggableTile(getBlockAt(antX, antY, antZ))) {
      damageTileAt(antX, antY, antZ, 10);
    }

    handleFoodInteractions(col, ant, antX, antY, antZ);
  });
}

// Pheromone-led worker AI for the black colony


/*
  * Pheromone trail-following worker AI.
  *
  * Workers deposit a "trail" pheromone when carrying food
  * Workers deposit a "footprint" pheromone (periodically?) when traveling, to mark explored areas and discourage aimless wandering
  * Workers deposit an "alarm" pheromone when threatened by nearby enemies, to warn nestmates and recruit soldiers
  * When triggered by an alarm pheromone, workers can either flee (random, fast wander) or attack 
  * Workers prefer paths with stronger trail pheromone
  * Soliders stay close to "footprint" and "trail" pheromones and become aggressive with "alarm" pheromones
  * Ants tend to follow a direction and have a cone of "sense" for pheromones
  * 
  * 
  * Nest building:
  * Workers could use pheromones to coordinate nest excavation, with a "dig" pheromone that encourages 
  *     digging in certain areas and discourages it in others. This could lead to more efficient nest
  *     layouts and the emergence of distinct chambers for different purposes (e.g., nurseries, food storage, etc.).
  * 
  * Scout:
  * Slight bias toward low footprint pheromone to explore new areas.
  * Foraging is a basic behavior for ants and becomes more important based on availability of food in the nest
  * 
  * Worker/Forrager roles:
  * follow strongest trail gradient
  * If trail lost, random search with footprint bias
  * 
  * Soldier recruitment and defense:
  * When an ant encounters a threat (e.g., a spider or enemy ant), it deposits an "alarm" pheromone.
  * Soldiers move toward "alarm" pheromone gradients to find and neutralize threats.
  * They have a stronger response to "footprint" pheromones to stay near areas of high worker activity.
  * 
  * Alarm response:
  * If nest disturbed, ants release alarm pheromone
  * 
  * 
  * Ant Senses
  * - sensor angle: 45°
  * - sensor distance: 3 cells
  * - move toward stronger concentration, they follow a gradient, not just the strongest nearby cell
  * - ants lose direction with higher gradients, ants wander slightly [perceived = pheromone / (pheromone + k)]
  * - direction =
        pheromone_gradient
        + random_noise
  * - sensor_angle = 30–45°
  * - sensor_distance = 2–5 body lengths
  * - noise = ±10–20°
*/

import {
  TILE, ANT_TYPE, ANT_SPEED, PATH_TOLERANCE, WANDER_DIST,
  EGG_HATCH_TIME, state, DIRTY_STATE
} from '../core.js';
import * as Util from '../util/util.js';
import { damageTileAt, depositAlarmPheromoneIfThreatened, depositPheromone } from './physics.js';

function getPheromoneValue(map, x, y, z) {
  if (!(map instanceof Map)) return 0;
  return map.get(Util.get3dHash(x, y, z)) ?? 0;
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

function setPathToTarget(ant, target, tolerance = Util.PATH_TOLERANCE) {
  if (!target) return false;
  const path = Util.findPath(
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
  if (!Util.isMoveOutsideWorld(nx, ny, nz)) {
    ant.x = nx;
    ant.y = ny;
    ant.z = nz;
  }
}

function updateWorkerPheromoneTrail(ant, colonyIndex) {
  const antX = Math.floor(ant.x);
  const antY = Math.floor(ant.y);
  const antZ = Math.floor(ant.z);
  const currentTileKey = Util.get3dHash(antX, antY, antZ);

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
  const currentTileKey = Util.get3dHash(antX, antY, antZ);

  if (entity.lastAlarmPheromoneTile === currentTileKey) return;
  if (depositAlarmPheromoneIfThreatened(colonyIndex, antX, antY, antZ)) {
    entity.lastAlarmPheromoneTile = currentTileKey;
  }
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

  /*  Sample random nearby tiles and choose the one with the strongest
   *  trail pheromone, adjusted by alarm pheromone and distance to nest.
   *  Needs direction, distance, gradient, and crowding heuristics
   */
  for (let i = 0; i < 24; i++) {
    const candidate = Util.getRandomNearbyEmptyTile(currentX, currentY, currentZ, 9);
    if (!candidate) continue;

    const trail = getPheromoneValue(trailMap, candidate.x, candidate.y, candidate.z);

    const alarm = getPheromoneValue(alarmMap, candidate.x, candidate.y, candidate.z);

    const nestDist = getNestDistance(col, candidate.x, candidate.y, candidate.z);

    const crowding = getWorkerCrowding(col, ant,
       candidate.x + 0.5, candidate.y + 0.5, candidate.z + 0.5);
    const score = (trail * 5.5)
      - (alarm * 5.0)
      - (crowding * 3.2);

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
    const candidate = Util.getRandomNearbyEmptyTile(currentX, currentY, currentZ, radius);
    if (!candidate) continue;

    const footprint = getPheromoneValue(footprintMap, candidate.x, candidate.y, candidate.z);
    const trail = getPheromoneValue(trailMap, candidate.x, candidate.y, candidate.z);
    const alarm = getPheromoneValue(alarmMap, candidate.x, candidate.y, candidate.z);
    //const nestDist = getNestDistance(col, candidate.x, candidate.y, candidate.z);
    const surfaceBias = col.nest.z - candidate.z;
    const crowding = getWorkerCrowding(col, ant, candidate.x + 0.5, candidate.y + 0.5, candidate.z + 0.5);

    let score;
    if (ant.role === 'forager') {
      score = (trail * 4.5)
        - (footprint * 0.7)
        - (alarm * 3.5)
        - (crowding * 1.4)
        + (surfaceBias * 0.9);
    } else {
      const desiredNestDist = 6.5;
      score = (footprint * 2.4)
        + (trail * 3.4)
        - (alarm * 4.0)
        - (crowding * 3.8)
        - (Math.max(0, footprint - 0.8) * 1.8)
        + (Math.min(trail, 2.5) * 0.18);
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

  const food = Util.findNearestFood(ant, ant.role === 'forager' ? 30 : 10);
  if (food && setPathToTarget(ant, food, PATH_TOLERANCE)) {
    return true;
  }

  const recruitmentTarget = chooseRecruitmentTarget(col, ant);
  if (recruitmentTarget && setPathToTarget(ant, recruitmentTarget, PATH_TOLERANCE * 1.3)) {
    return true;
  }

  //TODO: ants don't know distance to nest, this should be removed
  const nestDist = getNestDistance(col, ant.x, ant.y, ant.z);
  if (ant.role !== 'forager' && nestDist > 12) {
    return setPathToTarget(ant, col.nest, PATH_TOLERANCE);
  }

  const target = chooseScoredTarget(col, ant) || Util.getRandomNearbyEmptyTile(
    Math.floor(ant.x), Math.floor(ant.y), Math.floor(ant.z), ant.role === 'forager' ? 10 : 6
  );
  return setPathToTarget(ant, target, PATH_TOLERANCE * (ant.role === 'forager' ? 1.4 : 2.0));
}

function handleFoodInteractions(col, ant, antX, antY, antZ) {
  const tileHash = Util.get3dHash(antX, antY, antZ);

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
      const eggHash = Util.get3dHash(ex, ey, ez);
      if (!Util.isSolidTile(Util.getBlockAt(ex, ey, ez))) {
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

    if (Util.isDiggableTile(Util.getBlockAt(antX, antY, antZ))) {
      damageTileAt(antX, antY, antZ, 10);
    }

    handleFoodInteractions(col, ant, antX, antY, antZ);
  });
}

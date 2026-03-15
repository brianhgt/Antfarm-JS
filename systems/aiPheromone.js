// Pheromone-led worker AI for the black colony
import * as Entity from '../entities/entity.js';
import * as Core from '../core.js';
import * as Util from '../util/util.js';
import * as Physics from './physics.js';

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
  * Uses a spiral search pattern when lost.
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

function getPheromoneValue(map, x, y, z) {
  if (!(map instanceof Map)) return 0;
  return map.get(Util.get3dHash(x, y, z)) ?? 0;
}

/*
function getNestDistance(col, x, y, z) {
  const dx = x - col.nest.x;
  const dy = y - col.nest.y;
  const dz = z - col.nest.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
  */

function ensureWorkerRole(ant, col) {
  //this isn't correct, should be based on environment and colony state, not random chance
  if (ant.role) return;
  ant.role = Core.random() < (col.foragerRatio ?? 0.25) ? 'forager' : 'worker';
}

function setPathToTarget(ant, target, tolerance = Util.PATH_TOLERANCE) {
  if (!target) return false;
  // Avoid setting a path to the tile we're already standing on.
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  const tz = Math.floor(target.z);
  if (tx === Math.floor(ant.x) && ty === Math.floor(ant.y) && tz === Math.floor(ant.z)) return false;
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


function updateWorkerPheromoneTrail(ant, colonyIndex) {
  const antX = Math.floor(ant.x);
  const antY = Math.floor(ant.y);
  const antZ = Math.floor(ant.z);
  const currentTileKey = Util.get3dHash(antX, antY, antZ);

  if (ant.lastPheromoneTile === currentTileKey) return;
  ant.lastPheromoneTile = currentTileKey;

  if (ant.carrying === Core.TILE.FOOD) {
    Physics.depositPheromone('trail', colonyIndex, antX, antY, antZ, ant.role === 'forager' ? 1.5 : 1);
    return;
  }

  Physics.depositPheromone('footprint', colonyIndex, antX, antY, antZ, ant.role === 'worker' ? 1.2 : 0.75);
}

function updateAlarmPheromone(entity, colonyIndex) {
  const antX = Math.floor(entity.x);
  const antY = Math.floor(entity.y);
  const antZ = Math.floor(entity.z);
  const currentTileKey = Util.get3dHash(antX, antY, antZ);
  if(Physics.isThreatened(colonyIndex, antX, antY, antZ)) {
    Physics.depositPheromone('alarm', colonyIndex, antX, antY, antZ, 1);
  }
  // if (entity.lastAlarmPheromoneTile === currentTileKey) return;
  // if (depositAlarmPheromoneIfThreatened(colonyIndex, antX, antY, antZ)) {
  //   entity.lastAlarmPheromoneTile = currentTileKey;
  // }
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

function getLocalGradientCandidate(col, ant, maxDist = 3) {
  const currentX = Math.floor(ant.x);
  const currentY = Math.floor(ant.y);
  const currentZ = Math.floor(ant.z);
  const footprintMap = col.pheromones?.footprint;
  const trailMap = col.pheromones?.trail;
  const alarmMap = col.pheromones?.alarm;

  // Sample immediate neighbors and a few slightly farther offsets
  const offsets = [
    {dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1},
    {dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1},
    {dx:2,dy:0},{dx:-2,dy:0},{dx:0,dy:2},{dx:0,dy:-2},
    {dx:2,dy:1},{dx:1,dy:2},{dx:-2,dy:-1},{dx:-1,dy:-2}
  ];

  // Compute forward vector from ant.direction (if present). Expect yaw in degrees or a vector.
  let forward = null;
  const cosThreshold = Math.cos(45 * Math.PI / 180); // cos(±45°) -> 90° arc
  if (ant && ant.direction) {
    if (typeof ant.direction.yaw === 'number') {
      const yawRad = ant.direction.yaw * Math.PI / 180;
      forward = { x: Math.cos(yawRad), y: Math.sin(yawRad) };
    } else if (typeof ant.direction.x === 'number' && typeof ant.direction.y === 'number') {
      const len = Math.hypot(ant.direction.x, ant.direction.y);
      if (len > 1e-6) forward = { x: ant.direction.x / len, y: ant.direction.y / len };
    }
  }

  let best = null;
  let bestScore = -Infinity;

  for (const o of offsets) {
    // respect requested maxDist (approximate by chebyshev distance)
    const dist = Math.max(Math.abs(o.dx), Math.abs(o.dy));
    if (dist > maxDist) continue;

    // If we have a forward vector, only consider offsets within a 90° arc in front.
    const lenOffset = Math.hypot(o.dx, o.dy);
    if (forward && lenOffset > 0) {
      const cos = (o.dx * forward.x + o.dy * forward.y) / lenOffset;
      if (cos < cosThreshold) continue;
    }

    const x = currentX + o.dx;
    const y = currentY + o.dy;
    const z = currentZ;

    if (!Util.isValidBlock(x, y, z)) continue;
    if (!Util.isTileType(Util.getBlockAt(x, y, z), Core.TILE.EMPTY)) continue;

    const footprint = Math.min(getPheromoneValue(footprintMap, x, y, z), 2);
    const trail = Math.min(getPheromoneValue(trailMap, x, y, z), 6);
    const alarm = Math.min(getPheromoneValue(alarmMap, x, y, z), 4);
    const crowding = getWorkerCrowding(col, ant, x + 0.5, y + 0.5, z + 0.5);
    const surfaceBias = (col.nest && typeof col.nest.z === 'number') ? (col.nest.z - z) : 0;

    let score = calculateScore(ant, footprint, trail, alarm, crowding, surfaceBias, 0);

    if (score > bestScore) {
      bestScore = score;
      best = { x, y, z };
    }
  }

  return best;
}

function chooseRecruitmentTarget(col, ant) {
  if (ant.role !== 'worker') return null;

  const currentX = Math.floor(ant.x);
  const currentY = Math.floor(ant.y);
  const currentZ = Math.floor(ant.z);

  const alarmMap = col.pheromones?.alarm;
  const trailMap = col.pheromones?.trail;
  const footprintMap = col.pheromones?.footprint;

  let bestTarget = null;
  let bestScore = 0.9;
  

  /*  Sample random nearby tiles and choose the one with the strongest
   *  trail pheromone, adjusted by alarm pheromone and distance to nest.
   *  Needs direction, gradient, and crowding heuristics
   */
  const localCandidate = getLocalGradientCandidate(col, ant, 3);
  const nestVector = Util.getDirectionAsVector(ant.x, ant.y, ant.z, col.nest.x, col.nest.y, col.nest.z);
  for (let i = 0; i < 24; i++) {
    let candidate;
    //const candidate = Util.getRandomEmptyTileInDirection(currentX, currentY, currentZ, 9,
      // ant.direction);
    if (Core.random() < 0.6) {
      candidate = localCandidate || Util.getRandomNearbyEmptyTile(currentX, currentY, currentZ, 9);
    } else {
      candidate = Util.getRandomNearbyEmptyTile(currentX, currentY, currentZ, 9);
    }
    if (!candidate) continue;

    const footprint = Math.min(getPheromoneValue(footprintMap, candidate.x, candidate.y, candidate.z), 2);
    const trail = Math.min(getPheromoneValue(trailMap, candidate.x, candidate.y, candidate.z), 6);
    const alarm = Math.min(getPheromoneValue(alarmMap, candidate.x, candidate.y, candidate.z), 4);
    const crowding = getWorkerCrowding(col, ant, candidate.x + 0.5, candidate.y + 0.5, candidate.z + 0.5);

    const nestDist = Util.getDistance(col.nest.x, col.nest.y, col.nest.z, candidate.x, candidate.y, candidate.z);
    const candidateVector = Util.getDirectionAsVector(ant.x, ant.y, ant.z, candidate.x, candidate.y, candidate.z);
    const alignmentWithNest =  Math.min(Math.abs(Util.dotProduct(candidateVector, nestVector)), 1.0);

    const score = calculateScore(ant, footprint, trail, alarm, crowding, 0, alignmentWithNest);

    if (score > bestScore) {
      bestScore = score;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}

function calculateScore(ant, footprint, trail, alarm, crowding, surfaceBias, alignmentWithNest) {
  let score;
    if (ant.carrying === Core.TILE.FOOD) {
      score = (footprint * 2.4)
        + (trail * 0.7)
        - (alarm * 4.0)
        - (crowding * 3.8)
        + (Math.min(trail, 2.5) * 0.18)
        + (alignmentWithNest * 6.0);
    } else if (ant.role === 'forager') {
      score = (trail * 4.5)
        - (footprint * 0.7)
        - (alarm * 3.5)
        - (crowding * 1.4)
        + (surfaceBias * 0.9)
        - (alignmentWithNest * 1.0);;
    } else {
      score = (footprint * 1.4)
        + (trail * 3.4)
        - (alarm * 4.0)
        - (crowding * 3.8)
        - (Math.max(0, footprint - 0.8) * 1.8)
        + (Math.min(trail, 2.5) * 0.18)
        + (alignmentWithNest * 1.0);
    }
  return score;
}

function chooseScoredTarget(col, ant) {
  const currentX = Math.floor(ant.x);
  const currentY = Math.floor(ant.y);
  const currentZ = Math.floor(ant.z);
  const footprintMap = col.pheromones?.footprint;
  const trailMap = col.pheromones?.trail;
  const alarmMap = col.pheromones?.alarm;
  const radius = 4;
  const samples = ant.role === 'forager' ? 28 : 22;

  let bestTarget = null;
  let bestScore = -Infinity;

  const localCandidate = getLocalGradientCandidate(col, ant, Math.min(3, radius));
  const nestVector = Util.getDirectionAsVector(ant.x, ant.y, ant.z, col.nest.x, col.nest.y, col.nest.z);

  for (let i = 0; i < samples; i++) {
    let candidate;
    
  //const candidate = Util.getRandomEmptyTileInDirection(currentX, currentY, currentZ, radius,
      // ant.direction);
      
    if (Core.random() < 0.6) {
      candidate = localCandidate || Util.getRandomNearbyEmptyTile(currentX, currentY, currentZ, radius);
    } else {
      candidate = Util.getRandomNearbyEmptyTile(currentX, currentY, currentZ, radius);
    }
    if (!candidate) continue;

    const footprint = Math.min(getPheromoneValue(footprintMap, candidate.x, candidate.y, candidate.z), 2);
    const trail = Math.min(getPheromoneValue(trailMap, candidate.x, candidate.y, candidate.z), 6);
    const alarm = Math.min(getPheromoneValue(alarmMap, candidate.x, candidate.y, candidate.z), 4);
    const surfaceBias = col.nest.z - candidate.z;
    const crowding = getWorkerCrowding(col, ant, candidate.x + 0.5, candidate.y + 0.5, candidate.z + 0.5);


    const nestDist = Util.getDistance(col.nest.x, col.nest.y, col.nest.z, candidate.x, candidate.y, candidate.z);
    const candidateVector = Util.getDirectionAsVector(ant.x, ant.y, ant.z, candidate.x, candidate.y, candidate.z);
    const alignmentWithNest = Util.dotProduct(candidateVector, nestVector);

    let score = calculateScore(ant, footprint, trail, alarm, crowding, surfaceBias, alignmentWithNest);

    if (score > bestScore) {
      bestScore = score;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}

function chooseIdleTarget(col, ant) {
  
  // if (ant.carrying === Core.TILE.FOOD) {
  //   //TODO Drop it at nest, nest targeting is done with recruitment
  // }

  const recruitmentTarget = chooseRecruitmentTarget(col, ant);
  if (recruitmentTarget && setPathToTarget(ant, recruitmentTarget, Core.PATH_TOLERANCE * 1.3)) {
    return true;
  }

  if (ant.carrying !== Core.TILE.FOOD) {
    const food = Util.findNearestFood(ant, ant.role === 'forager' ? 30 : 10);
    if (food && setPathToTarget(ant, food, Core.PATH_TOLERANCE)) {
      return true;
    }
  }

  //TODO: ants don't know distance to nest, this should be removed
  /*
  const nestDist = getNestDistance(col, ant.x, ant.y, ant.z);
  if (ant.role !== 'forager' && nestDist > 12) {
    return setPathToTarget(ant, col.nest, PATH_TOLERANCE);
  }
  */

  const target = chooseScoredTarget(col, ant) || Util.getRandomNearbyEmptyTile(
    Math.floor(ant.x), Math.floor(ant.y), Math.floor(ant.z), ant.role === 'forager' ? 10 : 6
  );
  return setPathToTarget(ant, target, Core.PATH_TOLERANCE * (ant.role === 'forager' ? 1.4 : 2.0));
}

function handleFoodInteractions(col, ant, antX, antY, antZ) {
  const tileHash = Util.get3dHash(antX, antY, antZ);

  if (!ant.carrying && Core.state.foods.has(tileHash)) {
    if (Physics.pickupFood(ant, tileHash)) {
      // immediate trail deposit so the ant can follow back
      ant.lastPheromoneTile = null;
      Physics.depositPheromone('trail', col.index, antX, antY, antZ, ant.role === 'forager' ? 2.5 : 2);
      return;
    }
  }

  if (ant.carrying === Core.TILE.FOOD &&
      antX === col.nest.x && antY === col.nest.y && antZ === col.nest.z) {
    col.score++;
    ant.carrying = null;
    ant.target = null;
    ant.path = null;
    ant.lastPheromoneTile = null;
    ant.lastAlarmPheromoneTile = null;
    const eggType = Core.random() < 0.2 ? Core.ANT_TYPE.SOLDIER : Core.ANT_TYPE.WORKER;
    const angle = Core.random() * Math.PI * 2;
    const ex = col.nest.x + Math.floor(Math.cos(angle) * 2);
    const ez = col.nest.z + Math.floor(Math.sin(angle) * 2);
    const ey = col.nest.y;
    if (Core.state.colonies[col.index]) {
      const eggHash = Util.get3dHash(ex, ey, ez);
      if (!Util.isSolidTile(Util.getBlockAt(ex, ey, ez))) {
        col.eggs.set(eggHash, { x: ex, y: ey, z: ez, type: eggType, timer: Core.EGG_HATCH_TIME, carry: false });
        Core.state.foodDirty.set(eggHash, Core.DIRTY_STATE.CREATE);
      }
    }
  }
}

export function updateWorkers(col, colonyIndex, delta) {
  col.workers.forEach(ant => {
    ensureWorkerRole(ant, col);

    const antX = Math.floor(ant.x);
    const antY = Math.floor(ant.y);
    const antZ = Math.floor(ant.z);

    if(Physics.isThreatened(colonyIndex, antX, antY, antZ)) {
      Physics.depositPheromone('alarm', colonyIndex, antX, antY, antZ, 1);
      //TODO set random path
      //TODO find enemy and attack
    }

    if (!ant.path || ant.path[ant.pathIndex] === undefined
         || ant.path[ant.pathIndex] === null
        || ant.pathIndex === null) {
      ant.direction = null;
      chooseIdleTarget(col, ant);
    }

    let nextX = ant.path[ant.pathIndex].x;
    let nextY = ant.path[ant.pathIndex].y;
    let nextZ = ant.path[ant.pathIndex].z;

    if(Util.moveTo(ant, nextX, nextY, nextZ, Core.ANT_SPEED, delta)) {
      ant.pathIndex++;
      ant.direction = Util.getDirection(antX, antY, antZ,
         nextX, nextY, nextZ);
    }

    if (ant.path && ant.pathIndex >= ant.path.length) {
      ant.path = null;
      ant.target = null;
    }

    updateWorkerPheromoneTrail(ant, colonyIndex);
    updateAlarmPheromone(ant, colonyIndex);

    handleFoodInteractions(col, ant, antX, antY, antZ);
  });
}

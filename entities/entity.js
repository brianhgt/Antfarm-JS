// entities/entity.js — Shared entity movement helpers
import {
  TILE, ANT_TYPE, ANT_SPEED, PATH_TOLERANCE, WANDER_DIST,
  EGG_HATCH_TIME, state, DIRTY_STATE
} from '../core.js';
import * as Core from '../core.js';
import * as Util from '../util/util.js';

import { countTotalEntities } from '../systems/ai.js';

/**
 * Move an entity along its A* path.
 * Returns true if still moving, false if path exhausted.
 */
export function moveAlongPath(entity, speed, delta) {
  if (!entity.path || entity.pathIndex >= entity.path.length) {
    entity.path = null;
    return false;
  }

  const next = entity.path[entity.pathIndex];
  const dx = next.x + 0.5 - entity.x;
  const dy = next.y + 0.5 - entity.y;
  const dz = next.z + 0.5 - entity.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (len < 0.1) {
    entity.x = next.x + 0.5;
    entity.y = next.y + 0.5;
    entity.z = next.z + 0.5;
    entity.pathIndex++;
  } else {
    const step = speed * delta;
    const nx = entity.x + step * dx / len;
    const ny = entity.y + step * dy / len;
    const nz = entity.z + step * dz / len;
    if (!Util.isMoveOutsideWorld(nx, ny, nz)) {
      entity.x = nx;
      entity.y = ny;
      entity.z = nz;
    }
  }
  return true;
}

export function isAtTarget(entity, target, threshold = 0.5) {
  const dx = target.x - entity.x;
  const dy = target.y - entity.y;
  const dz = (target.z ?? 0) - (entity.z ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz) < threshold;
}

export function addNewAnt(colony, type, x, y, z) {
  if (countTotalEntities() >= state.maxEntities) {
    return;
  }

  const workerRole = colony.aiType === 'pheromone'
    ? (Core.random() < (colony.foragerRatio ?? 0.25) ? 'forager' : 'worker')
    : 'worker';

  if (type === ANT_TYPE.SOLDIER) {
    colony.soldiers.push({
      x: x + 0.5, y: y + 0.5, z: z + 0.5,
      path: null, pathIndex: 0, colIdx: colony.index, type: ANT_TYPE.SOLDIER,
      rotation: {pitch: 0, yaw: 0, roll: 0}, hp: 100, attackCooldown: 0
    });
  } else {
    colony.workers.push({
      x: x + 0.5, y: y + 0.5, z: z + 0.5,
      path: null, pathIndex: 0, colIdx: colony.index, type: ANT_TYPE.WORKER,
      role: workerRole,
      rotation: {pitch: 0, yaw: 0, roll: 0}, hp: 100, attackCooldown: 0
    });
  }

}
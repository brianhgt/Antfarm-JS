// entities/entity.js — Shared entity movement helpers

import { isMoveOutsideWorld } from '../util.js';

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
    if (!isMoveOutsideWorld(nx, ny, nz)) {
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

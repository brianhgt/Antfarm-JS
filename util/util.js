// util.js — Pure utility functions (tile ops, hashing, pathfinding, color)

import {
  TILE, DEFAULT_TILE_HP, WORLD_X_MAX, WORLD_Y_MAX, WORLD_Z_MAX, state, DIRTY_STATE, random
} from '../core.js';
import * as Core from '../core.js';
import * as Physics from '../systems/physics.js';

// ─── Tile helpers ──────────────────────────────────────────────

export function normalizeLocation(x, y, z) {
  return { x: Math.round(x), y: Math.round(y), z: Math.round(z) };
}

export function tileType(tileLike) {
  if (tileLike == null) return null;
  if (typeof tileLike === 'string') return tileLike;
  if (typeof tileLike === 'object') return tileLike.type ?? null;
  return null;
}

export function createTile(type, hp) {
  const fallbackHp = type === TILE.EMPTY ? 0 : (type === TILE.DIRT ? 30 : 10);
  const defaultHp = DEFAULT_TILE_HP[type] ?? fallbackHp;
  return { type, hp: hp === undefined ? defaultHp : hp };
}

export function normalizeTile(tileLike) {
  if (tileLike && typeof tileLike === 'object' && tileLike.type) {
    return createTile(tileLike.type, tileLike.hp);
  }
  if (typeof tileLike === 'string') {
    return createTile(tileLike);
  }
  return createTile(TILE.EMPTY);
}

export function isTileType(tileLike, type) {
  return tileType(tileLike) === type;
}

export function isSolidTile(tileLike) {
  const t = tileType(tileLike);
  return t === TILE.DIRT || t === TILE.ROCK || t === TILE.WATER;
}

export function isDiggableTile(tileLike) {
  const t = tileType(tileLike);
  return t === TILE.DIRT || t === TILE.ROCK;
}

// ─── World access ──────────────────────────────────────────────

export function isValidBlock(x, y, z) {
  return x >= 0 && x < WORLD_X_MAX && y >= 0 && y < WORLD_Y_MAX && z >= 0 && z < WORLD_Z_MAX;
}

export function isMoveOutsideWorld(x, y, z) {
  return x < 0 || x >= WORLD_X_MAX || y < 0 || y >= WORLD_Y_MAX || z < 0 || z >= WORLD_Z_MAX;
}

export function getBlockLocationAtKey(key) {
  const [x, y, z] = key.split(',').map(Number);
  return { x, y, z };
}

export function getBlockAtKey(key) {
  const { x, y, z } = getBlockLocationAtKey(key);
  return getBlockAt(x, y, z);
}

export function getBlockAt(x, y, z) {
  if (!isValidBlock(x, y, z)) return null;
  return state.viewMap[x][y][z];
}

export function setBlock(x, y, z, tile) {
  if (!isValidBlock(x, y, z)) return;
  const prevTile = state.viewMap[x][y][z];
  const nextTile = normalizeTile(tile);
  state.viewMap[x][y][z] = nextTile;

  const prevType = tileType(prevTile);
  const nextType = tileType(nextTile);
  const dirtyType = nextType === TILE.EMPTY
    ? DIRTY_STATE.DELETE
    : prevType === TILE.EMPTY
      ? DIRTY_STATE.CREATE
      : DIRTY_STATE.UPDATE;

  if (prevType !== nextType || (prevTile?.hp ?? 0) !== (nextTile?.hp ?? 0)) {
    state.viewMapDirty.set(get3dHash(x, y, z), dirtyType);
  }
}

export function getViewMap() {
  return state.viewMap;
}

// ─── Hashing & random ─────────────────────────────────────────

export function get3dHash(x, y, z) {
  //return z * (WORLD_X_MAX * WORLD_Y_MAX) + y * WORLD_X_MAX + x;
  return `${x},${y},${z}`;
}

export function getRandMap(map) {
  const values = Array.from(map.values());
  if (values.length === 0) return undefined;
  return values[Math.floor(Core.random() * values.length)];
}

// ─── Entity helpers ────────────────────────────────────────────

export function getPathJitter(entity, delta, magnitude = 0.16) {
  const jitterX = (Core.random() - 0.5) * magnitude * delta;
  const jitterY = (Core.random() - 0.5) * magnitude * delta;
  const jitterZ = (Core.random() - 0.5) * magnitude * delta;
  return { x: entity.x + jitterX, y: entity.y + jitterY, z: entity.z + jitterZ };
}

export function getRandomNearbyEmptyTile(centerX, centerY, centerZ, minRadius, maxRadius) {
  const resolvedMaxRadius = Math.max(0, Math.floor(maxRadius ?? minRadius ?? 0));
  const resolvedMinRadius = Math.max(0, Math.floor(maxRadius === undefined ? 0 : (minRadius ?? 0)));

  if (resolvedMinRadius > resolvedMaxRadius) return null;

  let attempts = 0;
  while (attempts < 100) {
    const x = centerX + Math.floor(Core.random() * (resolvedMaxRadius * 2 + 1)) - resolvedMaxRadius;
    const y = centerY + Math.floor(Core.random() * (resolvedMaxRadius * 2 + 1)) - resolvedMaxRadius;
    const z = centerZ + Math.floor(Core.random() * (resolvedMaxRadius * 2 + 1)) - resolvedMaxRadius;
    const dx = Math.abs(x - centerX);
    const dy = Math.abs(y - centerY);
    const dz = Math.abs(z - centerZ);
    const radius = Math.max(dx, dy, dz);

    if (radius < resolvedMinRadius) {
      attempts++;
      continue;
    }

    // Avoid returning the center tile so entities move off their current cell.
    if (x === centerX && y === centerY && z === centerZ) {
      attempts++;
      continue;
    }
    if (isValidBlock(x, y, z) && tileType(getBlockAt(x, y, z)) === TILE.EMPTY) {
      return { x, y, z };
    }
    attempts++;
  }
  return null;
}

export function getRandomEmptyTileInDirection(centerX, centerY, centerZ, minRadius, maxRadius, direction) {
  // Choose a random empty tile within a 45-degree arc centered on `direction`.
  // `direction` may be an object with `yaw` (degrees) or a vector `{x,y,z}`.
  if (!direction) return getRandomNearbyEmptyTile(centerX, centerY, centerZ, minRadius, maxRadius);

  const toRadians = deg => deg * Math.PI / 180;
  let yawRad = 0;

  if (typeof direction === 'object') {
    if (typeof direction.yaw === 'number') {
      yawRad = toRadians(direction.yaw);
    } else if (typeof direction.x === 'number' && typeof direction.y === 'number') {
      yawRad = Math.atan2(direction.y, direction.x);
    } else {
      return getRandomNearbyEmptyTile(centerX, centerY, centerZ, minRadius, maxRadius);
    }
  } else {
    return getRandomNearbyEmptyTile(centerX, centerY, centerZ, minRadius, maxRadius);
  }

  const halfArc = toRadians(90) / 2; // ±45° around the given direction
  const maxAttempts = 40;
  const r = Math.max(1, Math.floor(maxRadius || 1));

  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    const angle = yawRad + (Core.random() * 2 - 1) * halfArc;
    const dist = minRadius + Math.floor(Core.random() * (r - minRadius + 1)); // distance minRadius..r
    const rx = Math.round(centerX + Math.cos(angle) * dist);
    const ry = Math.round(centerY + Math.sin(angle) * dist);
    const rz = centerZ;

    if (!isValidBlock(rx, ry, rz)) continue;
    if (tileType(getBlockAt(rx, ry, rz)) === TILE.EMPTY) return { x: rx, y: ry, z: rz };
  }

  // fallback
  return getRandomNearbyEmptyTile(centerX, centerY, centerZ, minRadius, maxRadius);
}



export function moveTo(entity, x2, y2, z2, speed, delta) {

  const dx = x2 - entity.x;
  const dy = y2 - entity.y;
  const dz = z2 - entity.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (len < 0.1) {
    entity.x = x2;
    entity.y = y2;
    entity.z = z2;
    return true;
    } else {
      const step = speed * delta;
      const nx = entity.x + step * dx / len;
      const ny = entity.y + step * dy / len;
      const nz = entity.z + step * dz / len;

      const nextTile = normalizeLocation(nx, ny, nz);
      if (isMoveOutsideWorld(nextTile.x, nextTile.y, nextTile.z)) {
        return false;
      }

      if (isDiggableTile(getBlockAt(nextTile.x, nextTile.y, nextTile.z))) {
        if(Physics.damageTileAt(nextTile.x, nextTile.y, nextTile.z, 10) > 0) {
          return false;
        }
      }
      entity.x = nx;
      entity.y = ny;
      entity.z = nz;
  }
}

// ─── Direction Math ──────────────────────────────

export function getDistance(x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function getDirection2(entity, x2, y2, z2) {
  if (entity === undefined) return { yaw: 0, pitch: 0, roll: 0 };
  return getDirection(entity.x, entity.y, entity.z, x2, y2, z2);
}

export function getDirection(x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len === 0) return { yaw: 0, pitch: 0, roll: 0 };

  // Yaw: rotation around Z axis (in X-Y plane)
  const yaw = Math.atan2(dy, dx) * 180 / Math.PI;

  // Pitch: rotation around Y axis (vertical angle)
  const pitch = Math.atan2(dz, Math.sqrt(dx * dx + dy * dy)) * 180 / Math.PI;

  // Roll: for a direction vector, roll is typically 0
  const roll = 0;

  return { yaw, pitch, roll };
}

export function getDirectionAsVectorEntity(entity, x2, y2, z2) {
  return getDirectionAsVector(entity.x, entity.y, entity.z, x2, y2, z2);
}

export function getDirectionAsVector(x1, y1, z1, x2, y2, z2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dz = z2 - z1;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return {x: dx / len, y: dy / len, z: dz / len};
}

export function dotProduct(v1, v2) {
  return v1.x * v2.x + v1.y * v2.y + (v1.z ?? 0) * (v2.z ?? 0);
}

export function rotateDirection2D(direction, angleDeg) {
  const radians = angleDeg * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return normalizeDirection({
    x: (direction.x * cos) - (direction.y * sin),
    y: (direction.x * sin) + (direction.y * cos),
    z: direction.z ?? 0
  });
}

export function blendDirections(a, b, amount = 0.5) {
  return normalizeDirection({
    x: (a.x * (1 - amount)) + (b.x * amount),
    y: (a.y * (1 - amount)) + (b.y * amount),
    z: (a.z * (1 - amount)) + (b.z * amount)
  });
}

export function normalizeDirection(direction) {
  const len = Math.sqrt(direction.x * direction.x + direction.y * direction.y + (direction.z ?? 0) * (direction.z ?? 0));
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: direction.x / len, y: direction.y / len, z: (direction.z ?? 0) / len };
}

export function getRandomTurnDirection(baseDirection, maxAngleDeg = 20) {
  const randomAngle = ((Core.random() * 2) - 1) * maxAngleDeg;
  return rotateDirection2D(baseDirection, randomAngle);
}

// ─── Food ──────────────────────────────

export function findFoodAt(fx, fy, fz) {
  let found = null;
  state.foods.forEach(food => {
    if (Math.abs(food.x - fx) < 0.7 && Math.abs(food.y - fy) < 0.7 && Math.abs(food.z - fz) < 0.7) {
      found = food;
    }
  });
  return found;
}

export function findNearestFood(ant, maxDistance = Infinity) {
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

// ─── A* Pathfinding ────────────────────────────────────────────

const dirs = [
  {x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:-1,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1},
  {x:1,y:0,z:1},{x:1,y:0,z:-1},{x:-1,y:0,z:1},{x:-1,y:0,z:-1},
  {x:1,y:1,z:0},{x:1,y:-1,z:0},{x:-1,y:1,z:0},{x:-1,y:-1,z:0}
];

export class MinHeap {
  constructor() { this.items = []; }
  push(node) {
    this.items.push(node);
    this.bubbleUpFrom(this.items.length - 1);
  }
  pop() {
    if (this.items.length < 2) return this.items.pop();
    const top = this.items[0];
    this.items[0] = this.items.pop();
    this.bubbleDownFrom(0);
    return top;
  }
  popWithTolerance(tolerance = 0) {
    if (this.items.length === 0) return null;
    if (tolerance <= 0 || this.items.length === 1) return this.pop();
    const bestF = this.items[0].f;
    const threshold = bestF * (1 + tolerance);
    const candidateIndices = [];
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].f <= threshold) candidateIndices.push(i);
    }
    if (candidateIndices.length === 0) return this.pop();
    const pickIndex = candidateIndices[Math.floor(Core.random() * candidateIndices.length)];
    return this.removeAt(pickIndex);
  }
  removeAt(index) {
    const lastIndex = this.items.length - 1;
    if (index < 0 || index > lastIndex) return null;
    if (index === lastIndex) return this.items.pop();
    const removed = this.items[index];
    this.items[index] = this.items.pop();
    this.bubbleDownFrom(index);
    this.bubbleUpFrom(index);
    return removed;
  }
  bubbleUpFrom(i) {
    while (i > 0) {
      let p = Math.floor((i - 1) / 2);
      if (this.items[i].f >= this.items[p].f) break;
      [this.items[i], this.items[p]] = [this.items[p], this.items[i]];
      i = p;
    }
  }
  bubbleDownFrom(i) {
    const l = this.items.length;
    while (true) {
      let left = 2 * i + 1, right = 2 * i + 2, smallest = i;
      if (left < l && this.items[left].f < this.items[smallest].f) smallest = left;
      if (right < l && this.items[right].f < this.items[smallest].f) smallest = right;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
      i = smallest;
    }
  }
  isEmpty() { return this.items.length === 0; }
}

export function findPath(startX, startY, startZ, goalX, goalY, goalZ, tolerance = 0.08) {
  const open = new MinHeap();
  const openSet = new Set();
  const closed = new Set();
  const cameFrom = {};
  const gScore = {};
  const fScore = {};
  const mapX = WORLD_X_MAX;
  const mapY = WORLD_Y_MAX;

  function key(x, y, z) { return z * (mapX * mapY) + y * mapX + x; }

  let startK = key(startX, startY, startZ);
  gScore[startK] = 0;
  fScore[startK] = Math.abs(goalX - startX) + Math.abs(goalY - startY) + Math.abs(goalZ - startZ);
  open.push({ x: startX, y: startY, z: startZ, f: fScore[startK] });
  openSet.add(startK);

  while (!open.isEmpty()) {
    let current = open.popWithTolerance(tolerance);
    if (!current) break;
    let currK = key(current.x, current.y, current.z);
    openSet.delete(currK);

    if (current.x === goalX && current.y === goalY && current.z === goalZ) {
      let path = [{ x: goalX, y: goalY, z: goalZ }];
      while (cameFrom[key(path[0].x, path[0].y, path[0].z)]) {
        path.unshift(cameFrom[key(path[0].x, path[0].y, path[0].z)]);
      }
      return path;
    }

    closed.add(currK);
    const neighborDirs = [...dirs].sort(() => Core.random() - 0.5);

    for (let d of neighborDirs) {
      let nx = current.x + d.x;
      let ny = current.y + d.y;
      let nz = current.z + d.z;
      if (nx < 0 || nx >= mapX || ny < 0 || ny >= mapY || nz < 0 || nz >= WORLD_Z_MAX) continue;
      if (isSolidTile(getBlockAt(nx, ny, nz))) continue;

      let nk = key(nx, ny, nz);
      if (closed.has(nk)) continue;

      let tentativeG = (gScore[currK] === undefined ? Infinity : gScore[currK]) + 1;
      if (gScore[nk] === undefined || tentativeG < gScore[nk]) {
        cameFrom[nk] = { x: current.x, y: current.y, z: current.z };
        gScore[nk] = tentativeG;
        fScore[nk] = tentativeG + Math.abs(goalX - nx) + Math.abs(goalY - ny) + Math.abs(goalZ - nz);
        if (!openSet.has(nk)) {
          open.push({ x: nx, y: ny, z: nz, f: fScore[nk] });
          openSet.add(nk);
        }
      }
    }
  }
  return null;
}
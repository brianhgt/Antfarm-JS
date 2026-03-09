// util.js — Pure utility functions (tile ops, hashing, pathfinding, color)

import {
  TILE, DEFAULT_TILE_HP, WORLD_X_MAX, WORLD_Y_MAX, WORLD_Z_MAX, state
} from './core.js';

// ─── Tile helpers ──────────────────────────────────────────────

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

// ─── Hashing & random ─────────────────────────────────────────

export function get3dHash(x, y, z) {
  //return z * (WORLD_X_MAX * WORLD_Y_MAX) + y * WORLD_X_MAX + x;
  return `${x},${y},${z}`;
}

export function getRandMap(map) {
  const values = Array.from(map.values());
  if (values.length === 0) return undefined;
  return values[Math.floor(Math.random() * values.length)];
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
  state.viewMap[x][y][z] = normalizeTile(tile);
}

export function getViewMap() {
  return state.viewMap;
}

// ─── Entity helpers ────────────────────────────────────────────

export function findFoodAt(fx, fy, fz) {
  let found = null;
  state.foods.forEach(food => {
    if (Math.abs(food.x - fx) < 0.7 && Math.abs(food.y - fy) < 0.7 && Math.abs(food.z - fz) < 0.7) {
      found = food;
    }
  });
  return found;
}

export function getPathJitter(entity, delta, magnitude = 0.16) {
  const jitterX = (Math.random() - 0.5) * magnitude * delta;
  const jitterY = (Math.random() - 0.5) * magnitude * delta;
  const jitterZ = (Math.random() - 0.5) * magnitude * delta;
  return { x: entity.x + jitterX, y: entity.y + jitterY, z: entity.z + jitterZ };
}

export function getRandomNearbyEmptyTile(centerX, centerY, centerZ, radius) {
  let attempts = 0;
  while (attempts < 100) {
    const x = centerX + Math.floor(Math.random() * (radius * 2 + 1)) - radius;
    const y = centerY + Math.floor(Math.random() * (radius * 2 + 1)) - radius;
    const z = centerZ + Math.floor(Math.random() * (radius * 2 + 1)) - radius;
    if (isValidBlock(x, y, z) && tileType(getBlockAt(x, y, z)) === TILE.EMPTY) {
      return { x, y, z };
    }
    attempts++;
  }
  return null;
}

// ─── Color utilities ───────────────────────────────────────────

export function blendColor(c1, c2, amount) {
  function hexToRgb(hex) {
    hex = hex.replace("#", "");
    return {
      r: parseInt(hex.substring(0, 2), 16),
      g: parseInt(hex.substring(2, 4), 16),
      b: parseInt(hex.substring(4, 6), 16)
    };
  }
  function rgbToHex(r, g, b) {
    return "#" +
      r.toString(16).padStart(2, '0') +
      g.toString(16).padStart(2, '0') +
      b.toString(16).padStart(2, '0');
  }

  let rgb1 = hexToRgb(c1);
  let rgb2 = hexToRgb(c2);
  const brightness = rgb1.r + rgb1.g + rgb1.b;
  if (brightness < 30) { rgb1.r = 60; rgb1.g = 40; rgb1.b = 60; }

  let r = Math.round(rgb1.r * (1 - amount) + rgb2.r * amount);
  let g = Math.round(rgb1.g * (1 - amount) + rgb2.g * amount);
  let b = Math.round(rgb1.b * (1 - amount) + rgb2.b * amount);
  return rgbToHex(r, g, b);
}

export function hexToRgba(hex, alpha = 1.0) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function toTransparentColor(color, alpha) {
  let tempCtx = document.createElement('canvas').getContext('2d');
  tempCtx.fillStyle = color;
  let computed = tempCtx.fillStyle;
  let match = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return color;
  let [_, r, g, b] = match;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
    const pickIndex = candidateIndices[Math.floor(Math.random() * candidateIndices.length)];
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
    const neighborDirs = tolerance > 0 && Math.random() < 0.1
      ? [...dirs].sort(() => Math.random() - 0.5)
      : dirs;

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

// Utility functions and constants for Antfarm JS


function tileType(tileLike) {
  if(tileLike == null) return null;
  if(typeof tileLike === 'string') return tileLike;
  if(typeof tileLike === 'object') return tileLike.type ?? null;
  return null;
}

function createTile(type, hp) {
  const fallbackHp = type === TILE.EMPTY ? 0 : (type === TILE.DIRT ? 30 : 10);
  const defaultHp = typeof DEFAULT_TILE_HP !== 'undefined'
    ? (DEFAULT_TILE_HP[type] ?? fallbackHp)
    : fallbackHp;
  return { type, hp: hp === undefined ? defaultHp : hp };
}

function normalizeTile(tileLike) {
  if(tileLike && typeof tileLike === 'object' && tileLike.type) {
    return createTile(tileLike.type, tileLike.hp);
  }
  if(typeof tileLike === 'string') {
    return createTile(tileLike);
  }
  return createTile(TILE.EMPTY);
}

function isSolidTileValue(tileLike) {
  const type = tileType(tileLike);
  return type === TILE.DIRT || type === TILE.ROCK || type === TILE.WATER;
}

function isDiggableTileValue(tileLike) {
  const type = tileType(tileLike);
  return type === TILE.DIRT || type === TILE.ROCK;
}

// Utility functions

function get3dHash(x, y, z) {
  return z * (WORLD_X_MAX * WORLD_Y_MAX) + y * WORLD_X_MAX + x;
}

function getRandMap(map) {
  const values = Array.from(map.values());
  if (values.length === 0) return undefined;
  const index = Math.floor(Math.random() * values.length);
  return values[index];
}

function findFoodAt(fx, fy, fz) {
  let found = null;
  foods.forEach(food => {
    if (Math.abs(food.x - fx) < 0.7 && Math.abs(food.y - fy) < 0.7 && Math.abs(food.z - fz) < 0.7) {
      found = food;
    }
  });
  return found;
}

function blendColor(c1, c2, amount) {
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

  // If the base color is too dark, brighten it slightly before blending
  const brightness = rgb1.r + rgb1.g + rgb1.b;
  if (brightness < 30) {
    rgb1.r = 60;
    rgb1.g = 40;
    rgb1.b = 60;
  }

  let r = Math.round(rgb1.r * (1 - amount) + rgb2.r * amount);
  let g = Math.round(rgb1.g * (1 - amount) + rgb2.g * amount);
  let b = Math.round(rgb1.b * (1 - amount) + rgb2.b * amount);

  return rgbToHex(r, g, b);
}

function isValidBlock(x, y, z) {
  return x >= 0 && x < WORLD_X_MAX && y >= 0 && y < WORLD_Y_MAX && z >= 0 && z < WORLD_Z_MAX;
}

function isMoveOutsideWorld(x, y, z) {
  return x < 0 || x >= WORLD_X_MAX || y < 0 || y >= WORLD_Y_MAX || z < 0 || z >= WORLD_Z_MAX;
}

function getBlockAt(x, y, z) {
  if (!isValidBlock(x, y, z)) return null;
  return world[x][y][z];
}

function setBlock(x, y, z, tile) {
  if (!isValidBlock(x, y, z)) return;
  world[x][y][z] = normalizeTile(tile);
}


function getViewMap() {
  return currentView === 'nest' ? world : overworld;
}

function getPathJitter(entity, delta, magnitude = 0.16) {
  const jitterX = (Math.random() - 0.5) * magnitude * delta;
  const jitterY = (Math.random() - 0.5) * magnitude * delta;
  const jitterZ = (Math.random() - 0.5) * magnitude * delta;
  return { x: entity.x + jitterX, y: entity.y + jitterY, z: entity.z + jitterZ };
}


function getNearestAnt(s) {
  let nearest = null;
  let minDist = Infinity;
  colonies.forEach(col => {
    [col.player, ...col.workers].forEach(ant => {
      if (!ant) return;
      const dx = ant.x - s.x;
      const dy = ant.y - s.y;
      const dz = (ant.z ?? 0) - (s.z ?? 0);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < minDist) {
        minDist = dist;
        nearest = ant;
      }
    });
  });
  return nearest ? { ant: nearest, dist: minDist } : null;
}

function getNearestSoldier(s) {
  let nearest = null;
  let minDist = Infinity;
  colonies.forEach(col => {
    col.soldiers.forEach(sol => {
      const dist = Math.abs(sol.x - s.x) + Math.abs(sol.y - s.y) + Math.abs(sol.z - s.z);
      if (dist < minDist) {
        minDist = dist;
        nearest = sol;
      }
    });
  });
  return nearest;
}

function spawnEggNearNest(col, type) {
  if(type === undefined) type = ANT_TYPE.WORKER;

  let angle = Math.random() * Math.PI * 2;
  let ex = col.nest.x + Math.floor(Math.cos(angle) * 2);
  let ez = col.nest.z + Math.floor(Math.sin(angle) * 2);
  let ey = col.nest.y;

  if(isValidBlock(ex, ey, ez) && (tileType(getBlockAt(ex, ey, ez)) === TILE.DIRT || tileType(getBlockAt(ex, ey, ez)) === TILE.EMPTY)) {
    if(typeof maxEntities !== 'undefined' && countTotalEntities() >= maxEntities) return;

    setBlock(ex, ey, ez, TILE.EMPTY);
    const egg = { x: ex, y: ey, z: ez, type: type, timer: EGG_HATCH_TIME, carry: false };
    if(col.eggs instanceof Map) {
      col.eggs.set(get3dHash(ex, ey, ez), egg);
    } else if(Array.isArray(col.eggs)) {
      col.eggs.push(egg);
    }
  }
}

function countTotalEntities() {
  let total = 0;
  colonies.forEach(col => {
    const eggCount = col.eggs instanceof Map ? col.eggs.size : (Array.isArray(col.eggs) ? col.eggs.length : 0);
    total += col.workers.length + col.soldiers.length + eggCount;
  });
  total += spiders.length;
  return total;
}

function getRandomNearbyEmptyTile(centerX, centerY, centerZ, radius) {
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


let dirs = [
  {x:1,y:0,z:0},{x:-1,y:0,z:0},{x:0,y:1,z:0},{x:0,y:-1,z:0},{x:0,y:0,z:1},{x:0,y:0,z:-1},
  {x:1,y:0,z:1},{x:1,y:0,z:-1},{x:-1,y:0,z:1},{x:-1,y:0,z:-1},
  {x:1,y:1,z:0},{x:1,y:-1,z:0},{x:-1,y:1,z:0},{x:-1,y:-1,z:0}
];

// A* pathfinding
function findPath(startX, startY, startZ, goalX, goalY, goalZ, tolerance = 0.08) {
  //open is a min-heap of {x,y,z,f} where f is the total estimated cost to reach the goal through that node
  const open = new MinHeap();
  //openSet is a Set of keys for O(1) containment checks to avoid adding duplicates to the open heap
  const openSet = new Set();
  //closed is a Set of keys for nodes we've already fully explored
  const closed = new Set();
  //cameFrom maps node keys to the previous node in the optimal path found so far
  const cameFrom = {};
  //gScore maps node keys to the cost of the cheapest path from start to that node found so far
  const gScore = {};
  //fScore maps node keys to the estimated total cost from start to goal through that node (gScore + heuristic)
  const fScore = {};

  // Use explicit world dimensions for clarity (x,y,z)
  const mapX = WORLD_X_MAX;
  const mapY = WORLD_Y_MAX;
  const mapZ = WORLD_Z_MAX;

  // Key function to convert 3D coordinates to a unique key for sets/maps
  function key(x,y,z){ return z * (mapX * mapY) + y * mapX + x; }

  // Initialize the start node
  let startK = key(startX, startY, startZ);
  gScore[startK] = 0;
  fScore[startK] = Math.abs(goalX - startX) + Math.abs(goalY - startY) + Math.abs(goalZ - startZ);
  open.push({x: startX, y: startY, z: startZ, f: fScore[startK]});
  openSet.add(startK);

  while (!open.isEmpty()) {
    let current = open.popWithTolerance(tolerance);
    if(!current) break;
    let currK = key(current.x, current.y, current.z);
    openSet.delete(currK);

    if (current.x === goalX && current.y === goalY && current.z === goalZ) {
      let path = [{x: goalX, y: goalY, z: goalZ}];
      while (cameFrom[key(path[0].x, path[0].y, path[0].z)]) {
        path.unshift(cameFrom[key(path[0].x, path[0].y, path[0].z)]);
      }
      return path;
    }

    closed.add(currK);
    // Explore neighbors in 6 cardinal directions + 12 diagonals
    // const neighborDirs = Math.random() < 0.95
    //   ? [...dirs].sort(() => Math.random() - 0.5)
    //   : dirs;
    
    const neighborDirs = tolerance > 0 && Math.random() < 0.1 ? [...dirs].sort(() => Math.random() - 0.5) : dirs;
    for (let d of neighborDirs) {
      let nx = current.x + d.x;
      let ny = current.y + d.y;
      let nz = current.z + d.z;

      if (nx < 0 || nx >= mapX || ny < 0 || ny >= mapY || nz < 0 || nz >= mapZ) continue;
      if (isSolidTile(getBlockAt(nx, ny, nz))) continue;

      let nk = key(nx, ny, nz);
      if (closed.has(nk)) continue;

      let tentativeG = (gScore[currK] === undefined ? Infinity : gScore[currK]) + 1;
      if (gScore[nk] === undefined || tentativeG < gScore[nk]) {
        cameFrom[nk] = {x: current.x, y: current.y, z: current.z};
        gScore[nk] = tentativeG;
        fScore[nk] = tentativeG + Math.abs(goalX - nx) + Math.abs(goalY - ny) + Math.abs(goalZ - nz);
        if (!openSet.has(nk)) {
          open.push({x: nx, y: ny, z: nz, f: fScore[nk]});
          openSet.add(nk);
        }
      }
    }
  }

  return null;
}


class MinHeap {
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
      if (this.items[i].f <= threshold) {
        candidateIndices.push(i);
      }
    }

    if (candidateIndices.length === 0) return this.pop();
    const pickIndex = candidateIndices[Math.floor(Math.random() * candidateIndices.length)];
    return this.removeAt(pickIndex);
  }
  removeAt(index) {
    const lastIndex = this.items.length - 1;
    if (index < 0 || index > lastIndex) return null;

    if (index === lastIndex) {
      return this.items.pop();
    }

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

const Util = {
  createTile: createTile,
  tileType: tileType,
  normalizeTile: normalizeTile,
  isTileType: (tileLike, type) => tileType(tileLike) === type,
  isSolidTile: isSolidTileValue,
  isDiggableTile: isDiggableTileValue,
  get3dHash,
  getRandMap,
  findFoodAt,
  blendColor,
  isValidBlock,
  isMoveOutsideWorld,
  getBlockAt,
  setBlock,
  getViewMap,
  getPathJitter,
  getNearestAnt,
  getNearestSoldier,
  spawnEggNearNest,
  countTotalEntities,
  getRandomNearbyEmptyTile,
  findPath,
  MinHeap
};

window.Util = Util;
Object.assign(window, {
  createTile: Util.createTile,
  normalizeTile: Util.normalizeTile,
  isTileType: Util.isTileType,
  isSolidTile: Util.isSolidTile,
  isDiggableTile: Util.isDiggableTile,
  get3dHash: Util.get3dHash,
  getRandMap: Util.getRandMap,
  findFoodAt: Util.findFoodAt,
  blendColor: Util.blendColor,
  isValidBlock: Util.isValidBlock,
  isMoveOutsideWorld: Util.isMoveOutsideWorld,
  getBlockAt: Util.getBlockAt,
  setBlock: Util.setBlock,
  getViewMap: Util.getViewMap,
  getPathJitter: Util.getPathJitter,
  getNearestAnt: Util.getNearestAnt,
  getNearestSoldier: Util.getNearestSoldier,
  spawnEggNearNest: Util.spawnEggNearNest,
  countTotalEntities: Util.countTotalEntities,
  getRandomNearbyEmptyTile: Util.getRandomNearbyEmptyTile,
  MinHeap: Util.MinHeap
});

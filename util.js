// Utility functions and constants for Antfarm JS

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;

function utilTileType(tileLike) {
  if(tileLike == null) return null;
  if(typeof tileLike === 'string') return tileLike;
  if(typeof tileLike === 'object') return tileLike.type ?? null;
  return null;
}

function utilNormalizeTile(tileLike) {
  if(tileLike && typeof tileLike === 'object' && tileLike.type) {
    return { type: tileLike.type, hp: tileLike.hp ?? (tileLike.type === TILE.DIRT ? 30 : 10) };
  }
  if(typeof tileLike === 'string') {
    return { type: tileLike, hp: tileLike === TILE.DIRT ? 30 : 10 };
  }
  return { type: TILE.EMPTY, hp: 0 };
}

function isSolidTileValue(tileLike) {
  const type = utilTileType(tileLike);
  return type === TILE.DIRT || type === TILE.ROCK || type === TILE.WATER;
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

function toTransparentColor(color, alpha) {
  // Create a temporary canvas to convert any CSS color to RGB
  let tempCtx = document.createElement('canvas').getContext('2d');
  tempCtx.fillStyle = color;
  let computed = tempCtx.fillStyle;

  // computed is now in rgb(...) form
  let match = computed.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!match) return color; // fallback to original color

  let [_, r, g, b] = match;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgba(hex, alpha = 1.0) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex.split('').map(c => c + c).join('');
  }
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  world[x][y][z] = utilNormalizeTile(tile);
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

function findPath(startX, startY, startZ, goalX, goalY, goalZ, tolerance = 0.08) {
  const map = getViewMap();
  const mapX = WORLD_X_MAX;
  const mapY = WORLD_Y_MAX;
  const mapZ = currentView === 'nest' ? WORLD_Z_MAX : 1;

  function key(x, y, z) { return z * (mapX * mapY) + y * mapX + x; }

  const startKey = key(startX, startY, startZ);
  const goalKey = key(goalX, goalY, goalZ);

  const openSet = new MinHeap();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  gScore.set(startKey, 0);
  fScore.set(startKey, Math.abs(startX - goalX) + Math.abs(startY - goalY) + Math.abs(startZ - goalZ));

  openSet.push({ key: startKey, x: startX, y: startY, z: startZ, f: fScore.get(startKey) });

  while (!openSet.isEmpty()) {
    const current = openSet.popWithTolerance(tolerance);
    if (!current) break;

    if (current.key === goalKey) {
      const path = [];
      let temp = current;
      while (temp) {
        path.unshift({ x: temp.x, y: temp.y, z: temp.z });
        temp = cameFrom.get(temp.key);
      }
      return path;
    }

    const neighbors = [
      { x: current.x + 1, y: current.y, z: current.z },
      { x: current.x - 1, y: current.y, z: current.z },
      { x: current.x, y: current.y + 1, z: current.z },
      { x: current.x, y: current.y - 1, z: current.z },
      { x: current.x, y: current.y, z: current.z + 1 },
      { x: current.x, y: current.y, z: current.z - 1 }
    ];

    for (const neighbor of neighbors) {
      if (neighbor.x < 0 || neighbor.x >= mapX || neighbor.y < 0 || neighbor.y >= mapY || neighbor.z < 0 || neighbor.z >= mapZ) continue;
      const tile = map[neighbor.x][neighbor.y][neighbor.z];
      if (isSolidTileValue(tile)) continue;

      const neighborKey = key(neighbor.x, neighbor.y, neighbor.z);
      const tentativeGScore = gScore.get(current.key) + 1;

      if (!gScore.has(neighborKey) || tentativeGScore < gScore.get(neighborKey)) {
        cameFrom.set(neighborKey, current);
        gScore.set(neighborKey, tentativeGScore);
        fScore.set(neighborKey, tentativeGScore + Math.abs(neighbor.x - goalX) + Math.abs(neighbor.y - goalY) + Math.abs(neighbor.z - goalZ));
        openSet.push({ key: neighborKey, x: neighbor.x, y: neighbor.y, z: neighbor.z, f: fScore.get(neighborKey) });
      }
    }
  }

  return null; // No path found
}

function getNearestAnt(s) {
  let nearest = null;
  let minDist = Infinity;
  colonies.forEach(col => {
    col.workers.forEach(w => {
      const dist = Math.abs(w.x - s.x) + Math.abs(w.y - s.y) + Math.abs(w.z - s.z);
      if (dist < minDist) {
        minDist = dist;
        nearest = w;
      }
    });
  });
  return nearest;
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
  const nestY = col.nestY;
  let attempts = 0;
  while (attempts < 100) {
    const ex = Math.floor(Math.random() * WORLD_X_MAX);
    const ey = nestY;
    const ez = Math.floor(Math.random() * WORLD_Z_MAX);
    if (utilTileType(getBlockAt(ex, ey, ez)) === TILE.NEST) {
      col.eggs.push({ x: ex, y: ey, z: ez, type: type, timer: EGG_HATCH_TIME });
      break;
    }
    attempts++;
  }
}

function countTotalEntities() {
  let total = 0;
  colonies.forEach(col => {
    total += col.workers.length + col.soldiers.length + col.eggs.length;
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
    if (isValidBlock(x, y, z) && utilTileType(getBlockAt(x, y, z)) === TILE.EMPTY) {
      return { x, y, z };
    }
    attempts++;
  }
  return null;
}

function getScreenBlockSize() {
  return TILE_SIZE * viewZoom;
}

function getVisibleBlocks() {
  const viewportWidth = viewportPanel.clientWidth;
  const viewportHeight = viewportPanel.clientHeight;
  const blockSize = getScreenBlockSize();
  return {
    width: viewportWidth / blockSize,
    height: viewportHeight / blockSize
  };
}

function applyZoom() {
  [bgCanvas, fgCanvas, dbgCanvas].forEach((canvas) => {
    canvas.style.transformOrigin = 'top left';
    canvas.style.transform = `scale(${viewZoom})`;
  });
}

function resizeCanvasesToViewport() {
  const viewportWidth = viewportPanel.clientWidth;
  const viewportHeight = viewportPanel.clientHeight;
  const blockSize = getScreenBlockSize();

  COLS = Math.floor(viewportWidth / blockSize);
  ROWS = Math.floor(viewportHeight / blockSize);

  COLS = Math.max(1, COLS);
  ROWS = Math.max(1, ROWS);
  canvasWidth = COLS * TILE_SIZE;
  canvasHeight = ROWS * TILE_SIZE;

  bgCanvas.width = fgCanvas.width = canvasWidth;
  bgCanvas.height = fgCanvas.height = canvasHeight;
  dbgCanvas.width = canvasWidth;
  dbgCanvas.height = canvasHeight;

  applyZoom();
}

function clampCameraToViewBounds() {
  const visible = getVisibleBlocks();
  const screenWidthInBlocks = visible.width;
  const screenHeightInBlocks = visible.height;

  if (primaryViewport.view === 'nest') {
    // nest view: camera1X pans world X, camera1Y pans world Z
    const maxCamera1X = Math.max(0, WORLD_X_MAX - screenWidthInBlocks);
    const maxCamera1Y = Math.max(0, WORLD_Z_MAX - screenHeightInBlocks);
    camera1X = Math.max(0, Math.min(camera1X, maxCamera1X));
    camera1Y = Math.max(0, Math.min(camera1Y, maxCamera1Y));
  } else {
    // overworld view: camera1X pans world X, camera1Y pans world Y
    const maxCamera1X = Math.max(0, WORLD_X_MAX - screenWidthInBlocks);
    const maxCamera1Y = Math.max(0, WORLD_Y_MAX - screenHeightInBlocks);
    camera1X = Math.max(0, Math.min(camera1X, maxCamera1X));
    camera1Y = Math.max(0, Math.min(camera1Y, maxCamera1Y));
  }
}

function clearDebug(ctx) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
}


const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.0;
const ZOOM_STEP = 0.1;

window.TILE_SIZE = 20;

//const canvas = jq("#gameCanvas")[0];
//const ctx = canvas.getContext("2d");
const showDebug = true;

window.viewportPanel = document.getElementById("viewportPanel");
window.bgCanvas = document.getElementById("bg");
window.fgCanvas = document.getElementById("fg");
window.dbgCanvas = document.getElementById("dbg");

window.COLS = Math.floor(window.viewportPanel.clientWidth / TILE_SIZE);
window.ROWS = Math.floor(window.viewportPanel.clientHeight / TILE_SIZE);
window.canvasWidth = window.COLS * TILE_SIZE;
window.canvasHeight = window.ROWS * TILE_SIZE;

window.bgCanvas.width = window.fgCanvas.width = window.canvasWidth;
window.bgCanvas.height = window.fgCanvas.height = window.canvasHeight;
window.dbgCanvas.width = window.canvasWidth;
window.dbgCanvas.height = window.canvasHeight;

window.bgCtx = window.bgCanvas.getContext("2d");
window.fgCtx = window.fgCanvas.getContext("2d");
window.dbgCtx = window.dbgCanvas.getContext("2d");

applyZoom();

resizeCanvasesToViewport();

// coordinate convention used throughout the code:
//   x - horizontal axis (0..WORLD_X_MAX-1)
//   y - world row / colony index (0..WORLD_Y_MAX-1)
//   z - vertical depth inside a nest (0..WORLD_Z_MAX-1)
// functions and data structures consistently accept/return values in x,y,z order
// which makes it easier to read and reason about 3‑D operations.

const primaryViewport = {
  id: 'primary',
  inputCanvas: dbgCanvas,
  get view() { return currentView; },
  set view(value) { currentView = value; },
  get cameraX() { return camera1X; },
  set cameraX(value) { camera1X = value; },
  get cameraY() { return camera1Y; },
  set cameraY(value) { camera1Y = value; }
};
// expose to utilities
window.primaryViewport = primaryViewport;


// Mutable configuration variables
let showDebugPaths = false;
let currentView = 'nest'; // 'nest' or 'overworld' or 'both'
let currentNestIndex = 0; // Which nest section we're viewing

window.NEST_MAX_DEPTH = 24; // maximum depth of the nest (z axis)

// Camera variables
let camera1X = 0;
let camera1Y = 0;
let viewZoom = 1;
window.viewZoom = viewZoom;
let antDeaths = 0;
// smoothing for FPS display (shared with game loop)
window.fpsSmoothed = 60;


const keys={}; // track keys
jq(document).keydown(e=>keys[e.key]=true);
jq(document).keyup(e=>keys[e.key]=false);

// Handle window resize
window.addEventListener('resize', function() {
  resizeCanvasesToViewport();
  clampCameraToViewBounds();
  drawBackground(bgCtx);
});





// Mouse wheel scrolling for camera
function clampCameraToViewBounds() {
  const visible = getVisibleBlocks();
  const screenWidthInBlocks = visible.width;
  const screenHeightInBlocks = visible.height;

  if(primaryViewport.view === 'nest') {
    // nest view: camera1X pans world X, camera1Y pans world Z
    const maxCamera1X = Math.max(0, WORLD_X_MAX - screenWidthInBlocks);
    const maxCamera1Y = Math.max(0, WORLD_Z_MAX - screenHeightInBlocks);
    primaryViewport.cameraX = Math.max(0, Math.min(primaryViewport.cameraX, maxCamera1X));
    primaryViewport.cameraY = Math.max(0, Math.min(primaryViewport.cameraY, maxCamera1Y));
  } else {
    // overworld view: screen X maps to world Y, screen Y maps to world X
    const maxCamera1X = Math.max(0, WORLD_Y_MAX - screenWidthInBlocks);
    const maxCamera1Y = Math.max(0, WORLD_X_MAX - screenHeightInBlocks);
    primaryViewport.cameraX = Math.max(0, Math.min(primaryViewport.cameraX, maxCamera1X));
    primaryViewport.cameraY = Math.max(0, Math.min(primaryViewport.cameraY, maxCamera1Y));
  }
}

const inputCanvas = primaryViewport.inputCanvas;

inputCanvas.addEventListener('wheel', function(e) {
  e.preventDefault();

  // Increased sensitivity for better control
  const scrollSensitivity = 0.1 / viewZoom;

  if(e.deltaX !== 0) {
    primaryViewport.cameraX += e.deltaX * scrollSensitivity;
  }
  if(e.deltaY !== 0) {
    primaryViewport.cameraY += e.deltaY * scrollSensitivity;
  }

  clampCameraToViewBounds();
}, { passive: false });

let activePointerId = null;
let pointerStartX = 0;
let pointerStartY = 0;
let lastPointerX = 0;
let lastPointerY = 0;
let pointerDragged = false;
let suppressNextClick = false;

inputCanvas.addEventListener('pointerdown', function(e) {
  if(e.pointerType === 'mouse' && e.button !== 0) return;
  activePointerId = e.pointerId;
  pointerStartX = e.clientX;
  pointerStartY = e.clientY;
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  pointerDragged = false;
  if(inputCanvas.setPointerCapture) {
    inputCanvas.setPointerCapture(e.pointerId);
  }
  e.preventDefault();
});

inputCanvas.addEventListener('pointermove', function(e) {
  if(activePointerId !== e.pointerId) return;

  const deltaX = e.clientX - lastPointerX;
  const deltaY = e.clientY - lastPointerY;

  if(Math.abs(e.clientX - pointerStartX) + Math.abs(e.clientY - pointerStartY) > 3) {
    pointerDragged = true;
  }

  lastPointerX = e.clientX;
  lastPointerY = e.clientY;

  const panSensitivity = (e.pointerType === 'mouse') ? 0.08 : 0.06;
  // Invert deltaX for more intuitive panning (dragging right moves view right)
  primaryViewport.cameraX -= deltaX * (panSensitivity / viewZoom);
  primaryViewport.cameraY -= deltaY * (panSensitivity / viewZoom);
  clampCameraToViewBounds();
  e.preventDefault();
});

inputCanvas.addEventListener('pointerup', function(e) {
  if(activePointerId !== e.pointerId) return;
  suppressNextClick = pointerDragged;
  activePointerId = null;
  pointerDragged = false;
});

inputCanvas.addEventListener('pointercancel', function(e) {
  if(activePointerId !== e.pointerId) return;
  activePointerId = null;
  pointerDragged = false;
});


function worldToScreen(wx, wy, wz) {
    if(currentView === 'nest') {
      return { sx: wx * TILE_SIZE, sy: wz * TILE_SIZE };
    }
    return { sx: wy * TILE_SIZE, sy: wx * TILE_SIZE };
  }

function drawBackground(ctx) {
   // background terrain is now emitted in the foreground render queue
   // so everything shares one z-index sort pipeline.
   ctx.clearRect(0,0,canvasWidth,canvasHeight);
}

function drawForeground(ctx) {
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);
  ctx.save();
  ctx.translate(-camera1X * TILE_SIZE, -camera1Y * TILE_SIZE);

  const renderQueue = [];
  let renderOrder = 0;
  const visible = getVisibleBlocks();
  const cullBuffer = 1;
  const focusY = Math.floor((colonies[currentNestIndex]?.player?.y ?? colonies[0]?.player?.y) || 0);
  const isNest = currentView === 'nest';
  const Y_FADE_RANGE = 8;

  const getZIndex = (wx, wy, wz, layerBias, depthOffset = 0) => {
    if(isNest) return (wz + depthOffset) * 100 + layerBias;
    return (wx + depthOffset) * 10000 - wz * 1000 + layerBias;
  };

  const queue = (wx, wy, wz, layerBias, depthOffset, alpha, draw) => {
    renderQueue.push({
      zIndex: getZIndex(wx, wy, wz, layerBias, depthOffset),
      order: renderOrder++,
      draw: () => {
        const prev = ctx.globalAlpha;
        if(alpha !== 1) ctx.globalAlpha = prev * alpha;
        draw();
        if(alpha !== 1) ctx.globalAlpha = prev;
      }
    });
  };

  const queueRect = (wx, wy, wz, color, ox, oy, w, h, layerBias, depthOffset = 0, alpha = 1) => {
    const p = worldToScreen(wx, wy, wz);
    queue(wx, wy, wz, layerBias, depthOffset, alpha, () => {
      ctx.fillStyle = color;
      ctx.fillRect(p.sx + ox, p.sy + oy, w, h);
    });
  };

  const queueCircle = (wx, wy, wz, color, radius, layerBias, depthOffset = 0, alpha = 1) => {
    const p = worldToScreen(wx, wy, wz);
    queue(wx, wy, wz, layerBias, depthOffset, alpha, () => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  const queueText = (wx, wy, wz, text, color, layerBias, depthOffset = 0, alpha = 1) => {
    const p = worldToScreen(wx, wy, wz);
    queue(wx, wy, wz, layerBias, depthOffset, alpha, () => {
      ctx.fillStyle = color;
      ctx.fillText(text, p.sx, p.sy);
    });
  };

  const entityVisible = (y) => !isNest || Math.floor(y) === focusY;
  const distanceAlpha = (y, minAlpha = 0.18) => {
    if(!isNest) return 1;
    const dist = Math.abs(Math.floor(y) - focusY);
    return Math.max(minAlpha, 1 - Math.min(1, dist / Y_FADE_RANGE));
  };

  if(!isNest) {
    const minY = Math.max(0, Math.floor(camera1X));
    const maxY = Math.min(WORLD_Y_MAX, Math.ceil(camera1X + visible.width + cullBuffer));
    const minX = Math.max(0, Math.floor(camera1Y));
    const maxX = Math.min(WORLD_X_MAX, Math.ceil(camera1Y + visible.height + cullBuffer));
    for(let y = minY; y < maxY; y++) {
      for(let x = minX; x < maxX; x++) {
        if(Util.isTileType(Util.getBlockAt(x, y, 1), TILE.DIRT)) {
          queueRect(x, y, 1, "#5B3A1E", 0, 0, TILE_SIZE, TILE_SIZE, -90);
        }
      }
    }
  } else {
    const minZ = Math.max(0, Math.floor(camera1Y));
    const maxZ = Math.min(WORLD_Z_MAX, Math.ceil(camera1Y + visible.height + cullBuffer));
    const minX = Math.max(0, Math.floor(camera1X));
    const maxX = Math.min(WORLD_X_MAX, Math.ceil(camera1X + visible.width + cullBuffer));

    for(let z = minZ; z < maxZ; z++) {
      for(let x = minX; x < maxX; x++) {
        if(!Util.isTileType(Util.getBlockAt(x, focusY, z), TILE.DIRT)) continue;

        queueRect(x, focusY, z, "#5B3A1E", 0, 0, TILE_SIZE, TILE_SIZE, -90);

        let nearestEmptyDist = Infinity;
        for(let d = 1; d <= Y_FADE_RANGE; d++) {
          const yNeg = focusY - d;
          const yPos = focusY + d;

          if(yNeg >= 0 && Util.isTileType(Util.getBlockAt(x, yNeg, z), TILE.EMPTY)) {
            nearestEmptyDist = d;
            break;
          }
          if(yPos < WORLD_Y_MAX && Util.isTileType(Util.getBlockAt(x, yPos, z), TILE.EMPTY)) {
            nearestEmptyDist = d;
            break;
          }
        }

        if(nearestEmptyDist !== Infinity) {
          const proximity = (Y_FADE_RANGE - nearestEmptyDist + 1) / (Y_FADE_RANGE + 1);
          const overlayAlpha = 0.08 + proximity * 0.30;
          queueRect(x, focusY, z, "#000", 0, 0, TILE_SIZE, TILE_SIZE, -85, 0, overlayAlpha);
        }
      }
    }
  }

  foods.forEach(food => {
    if(food && entityVisible(food.y)) {
      queueRect(food.x, food.y, food.z, "green", 5, 5, TILE_SIZE - 10, TILE_SIZE - 10, 20);
    }
  });

  colonies.forEach(col => {
    queueRect(col.nest.x, col.nest.y, col.nest.z, "gray", 0, 0, TILE_SIZE, TILE_SIZE, 10, 0, distanceAlpha(col.nest.y, 0.2));
    queueRect(col.nest.sX, col.nest.sY, col.nest.sZ ?? col.nest.z, "purple", 0, 0, TILE_SIZE, TILE_SIZE, 11, 0, distanceAlpha(col.nest.sY, 0.2));

    if(entityVisible(col.player.y)) {
      queueCircle(col.player.x, col.player.y, col.player.z, col.color, TILE_SIZE / 2 - 2, 50, 0.45);
      if(col.player.carrying) {
        queueRect(col.player.x, col.player.y, col.player.z, Util.isTileType(col.player.carrying, TILE.FOOD) ? "green" : "white", 4, 4, 6, 6, 80, 0.45);
      }
    }

    col.workers.forEach(w => {
      if(!entityVisible(w.y)) return;
      queueCircle(w.x, w.y, w.z, col.color, TILE_SIZE / 2 - 3, 40, 0.45);
      if(w.carrying) {
        queueRect(w.x, w.y, w.z, isTileType(w.carrying, TILE.FOOD) ? "green" : "white", 4, 4, 6, 6, 70, 0.45);
      }
    });

    col.soldiers.forEach(ant => {
      if(entityVisible(ant.y)) {
        queueCircle(ant.x, ant.y, ant.z, col.color, TILE_SIZE * 0.45, 45, 0.45);
      }
    });

    col.eggs.forEach(egg => {
      if(!egg || egg.x === undefined || egg.z === undefined || !entityVisible(egg.y)) return;
      if(egg.carry) {
        queueRect(egg.x, egg.y, egg.z, "white", 4, 4, 6, 6, 65, 0.45);
      } else {
        queueRect(egg.x, egg.y, egg.z, "white", 5, 5, TILE_SIZE - 10, TILE_SIZE - 10, 15, 0.45);
      }
    });
  });

  spiders.forEach(s => {
    if(entityVisible(s.y)) {
      queueRect(s.x, s.y, s.z, s.timer > 0 ? "white" : "darkblue", 0, 0, TILE_SIZE, TILE_SIZE, 60, 0.45);
    }
  });

  skulls.forEach(sk => {
    if(entityVisible(sk.y)) {
      queueText(sk.x, sk.y, sk.z, "💀", "white", 90, 0.45);
    }
  });

  renderQueue.sort((a, b) => a.zIndex === b.zIndex ? a.order - b.order : a.zIndex - b.zIndex);
  renderQueue.forEach(item => item.draw());
  ctx.restore();
}

function drawDebug(ctx) {
   clearDebug(ctx);
   ctx.save();
   
   // Apply camera offset
   ctx.translate(-camera1X * TILE_SIZE, -camera1Y * TILE_SIZE);

   let dx = 0;
   let dy = 0;
  
   //ctx.fillStyle="yellow";
   colonies.forEach(col=>{
      col.workers.forEach(w=>{
         if (w.path) {
            //ctx.fillStyle = fadeCssColor("yellow", Math.min(1.0 - (w.pathIndex / w.path.length), 0.3));
            ctx.fillStyle = hexToRgba("#ffff00", (1.0 - (w.pathIndex / w.path.length)) * 0.15);
            w.path.forEach(next=>{
              let transformLoc = worldToScreen(next.x, next.y, next.z);
               dx = transformLoc.sx;
               dy = transformLoc.sy;
               ctx.fillRect(dx,dy,TILE_SIZE,TILE_SIZE);
            });
         }
      });
   });
   
   ctx.restore();
}

function clearDebug(ctx) {
   ctx.clearRect(0,0,canvasWidth,canvasHeight);
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
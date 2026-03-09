// render/render3D.js — Three.js 3D renderer (reads shared game state)

import {
  TILE, WORLD_X_MAX, WORLD_Y_MAX, WORLD_Z_MAX, state
} from '../core.js';
import { getBlockAt, isTileType } from '../util.js';

const SURFACE_Z = 1;
const TERRAIN_REBUILD_MS = 450;

let THREE_NS = null;
let scene, camera, renderer, controls;
let resizeHandler = null;

let blockMeshes = [];
let entityMeshes = new Map();
let terrainFocusY = 0;
let lastTerrainRebuildMs = 0;

let blockGeometry = null;
let sphereGeometry = null;

let dirtMat = null;
let rockMat = null;
let nestMat = null;
let foodMat = null;
let waterMat = null;
let eggMat = null;

const entityMaterialCache = new Map();

function getFocusY() {
  return Math.floor(state.colonies[0]?.player?.y ?? 0);
}

function worldToScene(x, y, z, focusY) {
  return {
    sx: x,
    sy: -z,
    sz: y - focusY
  };
}

function getBlockMaterial(block) {
  if (isTileType(block, TILE.DIRT)) return dirtMat;
  if (isTileType(block, TILE.ROCK)) return rockMat;
  if (isTileType(block, TILE.NEST)) return nestMat;
  if (isTileType(block, TILE.FOOD)) return foodMat;
  if (isTileType(block, TILE.WATER)) return waterMat;
  if (isTileType(block, TILE.EGG)) return eggMat;
  return null;
}

function clearTerrainMeshes() {
  blockMeshes.forEach(mesh => scene.remove(mesh));
  blockMeshes = [];
}

function rebuildTerrain() {
  if (!scene || !THREE_NS) return;

  clearTerrainMeshes();
  terrainFocusY = getFocusY();

  for (let x = 0; x < WORLD_X_MAX; x++) {
    for (let y = 0; y < WORLD_Y_MAX; y++) {
      const surfaceBlock = getBlockAt(x, y, SURFACE_Z);
      const material = getBlockMaterial(surfaceBlock);
      if (!material) continue;

      const p = worldToScene(x, y, SURFACE_Z, terrainFocusY);
      const mesh = new THREE_NS.Mesh(blockGeometry, material);
      mesh.position.set(p.sx, p.sy, p.sz);
      scene.add(mesh);
      blockMeshes.push(mesh);
    }
  }

  for (let x = 0; x < WORLD_X_MAX; x++) {
    for (let z = 0; z < WORLD_Z_MAX; z++) {
      if (z === SURFACE_Z) continue;

      const sliceBlock = getBlockAt(x, terrainFocusY, z);
      const material = getBlockMaterial(sliceBlock);
      if (!material) continue;

      const p = worldToScene(x, terrainFocusY, z, terrainFocusY);
      const mesh = new THREE_NS.Mesh(blockGeometry, material);
      mesh.position.set(p.sx, p.sy, p.sz);
      scene.add(mesh);
      blockMeshes.push(mesh);
    }
  }

  lastTerrainRebuildMs = performance.now();
}

function getEntityMaterial(color) {
  const key = color || 'white';
  if (entityMaterialCache.has(key)) return entityMaterialCache.get(key);

  const material = new THREE_NS.MeshLambertMaterial({ color: key });
  entityMaterialCache.set(key, material);
  return material;
}

function upsertEntitySphere(id, x, y, z, color, radius) {
  if (x === undefined || y === undefined || z === undefined) return;

  let mesh = entityMeshes.get(id);
  if (!mesh) {
    mesh = new THREE_NS.Mesh(sphereGeometry, getEntityMaterial(color));
    scene.add(mesh);
    entityMeshes.set(id, mesh);
  } else {
    mesh.material = getEntityMaterial(color);
  }

  const p = worldToScene(x, y, z, terrainFocusY);
  mesh.position.set(p.sx - 0.5, p.sy + 0.5 + radius * 0.2, p.sz - 0.5);
  mesh.scale.setScalar(radius * 2);
  mesh.userData.keep = true;
}

function syncEntityMeshes() {
  if (!scene || !THREE_NS) return;

  for (const mesh of entityMeshes.values()) {
    mesh.userData.keep = false;
  }

  state.foods.forEach((food, foodKey) => {
    if (!food) return;
    upsertEntitySphere(`food-${foodKey}`, food.x, food.y, food.z, 'green', 0.22);
  });

  state.colonies.forEach((col, colIndex) => {
    if (!col) return;
    const antColor = col.color || 'white';

    if (col.player) {
      upsertEntitySphere(`player-${colIndex}`, col.player.x, col.player.y, col.player.z, antColor, 0.44);
    }

    col.workers.forEach((worker, workerIndex) => {
      upsertEntitySphere(`worker-${colIndex}-${workerIndex}`, worker.x, worker.y, worker.z, antColor, 0.38);
    });

    col.soldiers.forEach((soldier, soldierIndex) => {
      upsertEntitySphere(`soldier-${colIndex}-${soldierIndex}`, soldier.x, soldier.y, soldier.z, antColor, 0.45);
    });

    col.eggs.forEach((egg, eggIndex) => {
      if (!egg) return;
      upsertEntitySphere(`egg-${colIndex}-${eggIndex}`, egg.x, egg.y, egg.z, 'white', 0.2);
    });
  });

  state.spiders.forEach((spider, spiderIndex) => {
    const spiderColor = spider.timer > 0 ? 'white' : 'darkblue';
    upsertEntitySphere(`spider-${spiderIndex}`, spider.x, spider.y, spider.z, spiderColor, 0.5);
  });

  for (const [id, mesh] of entityMeshes.entries()) {
    if (mesh.userData.keep) continue;
    scene.remove(mesh);
    entityMeshes.delete(id);
  }
}

function ensureTerrainFresh() {
  const focusY = getFocusY();
  const now = performance.now();
  if ((focusY !== terrainFocusY || (now - lastTerrainRebuildMs > TERRAIN_REBUILD_MS)
       && state.viewMapDirty)) {
    rebuildTerrain();
    state.viewMapDirty = false;
  }
}

/**
 * Initialise a 3D view inside `containerEl`.
 * Three.js is loaded dynamically via the importmap in index.html.
 */
export async function init3DView(containerEl) {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  THREE_NS = THREE;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa0522d);

  blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  sphereGeometry = new THREE.SphereGeometry(0.5, 12, 10);
  dirtMat = new THREE.MeshLambertMaterial({ color: '#5B3A1E' });
  rockMat = new THREE.MeshLambertMaterial({ color: '#888888' });
  nestMat = new THREE.MeshLambertMaterial({ color: '#cccccc' });
  foodMat = new THREE.MeshLambertMaterial({ color: 'green' });
  waterMat = new THREE.MeshLambertMaterial({ color: '#2b5faa' });
  eggMat = new THREE.MeshLambertMaterial({ color: 'white' });

  camera = new THREE.PerspectiveCamera(
    60,
    containerEl.clientWidth / containerEl.clientHeight,
    0.1,
    1000
  );
  camera.position.set(WORLD_X_MAX / 2, WORLD_Z_MAX * 1.4, WORLD_Y_MAX * 0.3);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
  containerEl.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(WORLD_X_MAX / 2, -WORLD_Z_MAX / 2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.update();

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // Resize handler
  resizeHandler = () => {
    if (!renderer || !camera) return;
    camera.aspect = containerEl.clientWidth / containerEl.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
  };
  window.addEventListener('resize', resizeHandler);

  rebuildTerrain();
  syncEntityMeshes();
}

export function render3D() {
  if (!renderer) return;

  ensureTerrainFresh();
  syncEntityMeshes();
  controls.update();
  renderer.render(scene, camera);
}

export function dispose3D() {
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    resizeHandler = null;
  }

  if (controls) {
    controls.dispose();
    controls = null;
  }

  clearTerrainMeshes();

  for (const mesh of entityMeshes.values()) {
    scene?.remove(mesh);
  }
  entityMeshes.clear();

  entityMaterialCache.clear();

  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
    renderer = null;
  }

  scene = null;
  camera = null;
  THREE_NS = null;
  blockGeometry = null;
  sphereGeometry = null;
  dirtMat = null;
  rockMat = null;
  nestMat = null;
  foodMat = null;
  waterMat = null;
  eggMat = null;
}

export async function switchTo3D(container) {
  state.bgCanvas.style.display = 'none';
  state.fgCanvas.style.display = 'none';
  state.dbgCanvas.style.display = 'none';
  await init3DView(container);
}

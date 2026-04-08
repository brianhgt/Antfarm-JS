// render/render3D.js — Three.js 3D renderer (reads shared game state)

import {
  DIRTY_STATE,
  TILE, WORLD_X_MAX, WORLD_Y_MAX, WORLD_Z_MAX, state
} from '../core.js';
import * as Util from '../util/util.js';

const SURFACE_Z = 1;
const TERRAIN_REBUILD_MS = 450;

let THREE_NS = null;
let scene, camera, renderer, controls;
let resizeHandler = null;

let blockMeshes = new Map();
let entityMeshes = new Map();
let terrainFocusY = 0;
let lastTerrainRebuildMs = 0;

let blockGeometry = null;
let sphereGeometry = null;
let directionLineMaterial = null;

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
  if (Util.isTileType(block, TILE.DIRT)) return dirtMat;
  if (Util.isTileType(block, TILE.ROCK)) return rockMat;
  if (Util.isTileType(block, TILE.NEST)) return nestMat;
  if (Util.isTileType(block, TILE.FOOD)) return foodMat;
  if (Util.isTileType(block, TILE.WATER)) return waterMat;
  if (Util.isTileType(block, TILE.EGG)) return eggMat;
  return null;
}

function clearTerrainMeshes() {
  blockMeshes.forEach(mesh => scene.remove(mesh));
  blockMeshes.clear();
}

function rebuildTerrain(isDirtyCheck = false) {
  if (!scene || !THREE_NS) return;

  terrainFocusY = getFocusY();

  if(isDirtyCheck) {
    // Only rebuild if there are dirty tiles in the current focus slice
    for (const [hash, dirtyType] of state.viewMapDirty) {
      const surfaceBlock = Util.getBlockAtKey(hash);
      const { x, y, z } = Util.getBlockLocationAtKey(hash);

      // Only care about changes on the surface slice at the current focus Y
      if(z !== SURFACE_Z && y !== terrainFocusY) continue;

      switch (dirtyType) {
        case DIRTY_STATE.CREATE: {
          const material = getBlockMaterial(surfaceBlock);
          if (!material) continue;
          const p = worldToScene(x, y, z, terrainFocusY);
          const mesh = new THREE_NS.Mesh(blockGeometry, material);
          mesh.position.set(p.sx, p.sy, p.sz);
          scene.add(mesh);
          blockMeshes.set(hash, mesh);
          break;
        }

        case DIRTY_STATE.UPDATE: {
          const materialUpdate = getBlockMaterial(surfaceBlock);
          if (!materialUpdate) continue;
          const updateMesh = blockMeshes.get(hash);
          if (updateMesh) updateMesh.material = materialUpdate;
          break;
        }

        case DIRTY_STATE.DELETE: {
          const deleteMesh = blockMeshes.get(hash);
          if (!deleteMesh) continue;
          blockMeshes.delete(hash);
          scene.remove(deleteMesh);
          break;
        }
      }
    }
  }
  else {
    clearTerrainMeshes();
    for (let x = 0; x < WORLD_X_MAX; x++) {
      for (let y = 0; y < WORLD_Y_MAX; y++) {
        const surfaceBlock = Util.getBlockAt(x, y, SURFACE_Z);
        const material = getBlockMaterial(surfaceBlock);
        if (!material) continue;

        const p = worldToScene(x, y, SURFACE_Z, terrainFocusY);
        const mesh = new THREE_NS.Mesh(blockGeometry, material);
        mesh.position.set(p.sx, p.sy, p.sz);
        scene.add(mesh);
        blockMeshes.set(Util.get3dHash(x, y, SURFACE_Z), mesh);
      }
    }

    for (let x = 0; x < WORLD_X_MAX; x++) {
      for (let z = 0; z < WORLD_Z_MAX; z++) {
        if (z === SURFACE_Z) continue;

        const sliceBlock = Util.getBlockAt(x, terrainFocusY, z);
        const material = getBlockMaterial(sliceBlock);
        if (!material) continue;

        const p = worldToScene(x, terrainFocusY, z, terrainFocusY);
        const mesh = new THREE_NS.Mesh(blockGeometry, material);
        mesh.position.set(p.sx, p.sy, p.sz);
        scene.add(mesh);
        blockMeshes.set(Util.get3dHash(x, terrainFocusY, z), mesh);
      }
    }
  }

  state.viewMapDirty.clear();
  lastTerrainRebuildMs = performance.now();
}

function getEntityMaterial(color) {
  const key = color || 'white';
  if (entityMaterialCache.has(key)) return entityMaterialCache.get(key);

  const material = new THREE_NS.MeshLambertMaterial({ color: key });
  entityMaterialCache.set(key, material);
  return material;
}

function getEntityDirectionVector(entity) {
  if (entity?.direction) {
    if (typeof entity.direction.yaw === 'number') {
      const yawRad = entity.direction.yaw * Math.PI / 180;
      const pitchRad = (entity.direction.pitch ?? 0) * Math.PI / 180;
      const planar = Math.cos(pitchRad);
      return {
        x: Math.cos(yawRad) * planar,
        y: Math.sin(yawRad) * planar,
        z: Math.sin(pitchRad)
      };
    }

    if (typeof entity.direction.x === 'number' && typeof entity.direction.y === 'number') {
      const dx = entity.direction.x;
      const dy = entity.direction.y;
      const dz = entity.direction.z ?? 0;
      const len = Math.hypot(dx, dy, dz);
      if (len > 1e-6) {
        return { x: dx / len, y: dy / len, z: dz / len };
      }
    }
  }

  if (entity?.path && entity.pathIndex != null && entity.path[entity.pathIndex]) {
    const next = entity.path[entity.pathIndex];
    return Util.getDirectionAsVector(entity.x, entity.y, entity.z, next.x + 0.5, next.y + 0.5, next.z + 0.5);
  }

  if (entity?.target) {
    return Util.getDirectionAsVector(entity.x, entity.y, entity.z, entity.target.x, entity.target.y, entity.target.z);
  }

  return null;
}

function updateDirectionLine(line, direction, radius) {
  if (!line?.geometry?.attributes?.position) return;

  const positions = line.geometry.attributes.position.array;
  const localDirection = direction
    ? { x: direction.x, y: -direction.z, z: direction.y }
    : { x: 0, y: 0.01, z: 0 };
  const len = Math.hypot(localDirection.x, localDirection.y, localDirection.z);
  const scale = radius * 1.8;
  const nx = len > 1e-6 ? localDirection.x / len : 0;
  const ny = len > 1e-6 ? localDirection.y / len : 1;
  const nz = len > 1e-6 ? localDirection.z / len : 0;

  positions[0] = 0;
  positions[1] = 0;
  positions[2] = 0;
  positions[3] = nx * scale;
  positions[4] = ny * scale;
  positions[5] = nz * scale;
  line.geometry.attributes.position.needsUpdate = true;
  line.visible = true;
}

function upsertEntitySphere(id, entity, color, radius) {
  const x = entity?.x;
  const y = entity?.y;
  const z = entity?.z;
  if (x === undefined || y === undefined || z === undefined) return;

  let group = entityMeshes.get(id);
  if (!group) {
    group = new THREE_NS.Group();

    const sphere = new THREE_NS.Mesh(sphereGeometry, getEntityMaterial(color));
    group.add(sphere);

    const lineGeometry = new THREE_NS.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE_NS.Float32BufferAttribute([0, 0, 0, 0, 0.01, 0], 3));
    const line = new THREE_NS.Line(lineGeometry, directionLineMaterial);
    group.add(line);

    group.userData.sphere = sphere;
    group.userData.directionLine = line;

    scene.add(group);
    entityMeshes.set(id, group);
  } else {
    group.userData.sphere.material = getEntityMaterial(color);
  }

  const p = worldToScene(x, y, z, terrainFocusY);
  group.position.set(p.sx - 0.5, p.sy + 0.5 + radius * 0.2, p.sz - 0.5);
  group.userData.sphere.scale.setScalar(radius * 2);
  updateDirectionLine(group.userData.directionLine, getEntityDirectionVector(entity), radius);
  group.userData.keep = true;
}

function syncEntityMeshes() {
  if (!scene || !THREE_NS) return;

  for (const mesh of entityMeshes.values()) {
    mesh.userData.keep = false;
  }

  state.foods.forEach((food, foodKey) => {
    if (!food) return;
    upsertEntitySphere(`food-${foodKey}`, food, 'green', 0.22);
  });

  state.colonies.forEach((col, colIndex) => {
    if (!col) return;
    const antColor = col.color || 'white';

    if (col.player) {
      upsertEntitySphere(`player-${colIndex}`, col.player, antColor, 0.44);
    }

    col.workers.forEach((worker, workerIndex) => {
      upsertEntitySphere(`worker-${colIndex}-${workerIndex}`, worker, antColor, 0.38);
    });

    col.soldiers.forEach((soldier, soldierIndex) => {
      upsertEntitySphere(`soldier-${colIndex}-${soldierIndex}`, soldier, antColor, 0.45);
    });

    col.eggs.forEach((egg, eggIndex) => {
      if (!egg) return;
      upsertEntitySphere(`egg-${colIndex}-${eggIndex}`, egg, 'white', 0.2);
    });
  });

  state.spiders.forEach((spider, spiderIndex) => {
    const spiderColor = spider.timer > 0 ? 'white' : 'darkblue';
    upsertEntitySphere(`spider-${spiderIndex}`, spider, spiderColor, 0.5);
  });

  for (const [id, mesh] of entityMeshes.entries()) {
    if (mesh.userData.keep) continue;
    mesh.userData.directionLine?.geometry?.dispose();
    scene.remove(mesh);
    entityMeshes.delete(id);
  }
}

function ensureTerrainFresh() {
  const focusY = getFocusY();
  const now = performance.now();
  if (focusY !== terrainFocusY) {
    rebuildTerrain();
  }
  else if (state.viewMapDirty.size > 0) {
    rebuildTerrain(true);
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
  directionLineMaterial = new THREE.LineBasicMaterial({ color: '#ffffff' });
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
    mesh.userData.directionLine?.geometry?.dispose();
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
  directionLineMaterial = null;
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

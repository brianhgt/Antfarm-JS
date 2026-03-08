// render/render3D.js — Three.js 3D renderer (reads shared game state)

import {
  TILE, WORLD_X_MAX, WORLD_Y_MAX, WORLD_Z_MAX, state
} from '../core.js';
import { getBlockAt, isTileType } from '../util.js';

let scene, camera, renderer, controls;
let blockMeshes = [];

/**
 * Initialise a 3D view inside `containerEl`.
 * Three.js is loaded dynamically via the importmap in index.html.
 */
export async function init3DView(containerEl) {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa0522d);

  camera = new THREE.PerspectiveCamera(
    60,
    containerEl.clientWidth / containerEl.clientHeight,
    0.1,
    1000
  );
  camera.position.set(WORLD_X_MAX / 2, WORLD_Z_MAX, WORLD_Y_MAX / 2);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
  containerEl.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(WORLD_X_MAX / 2, 0, WORLD_Y_MAX / 2);
  controls.update();

  // Lighting
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(10, 20, 10);
  scene.add(dirLight);

  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = containerEl.clientWidth / containerEl.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(containerEl.clientWidth, containerEl.clientHeight);
  });

  rebuildBlocks(THREE);
}

function rebuildBlocks(THREE) {
  blockMeshes.forEach(m => scene.remove(m));
  blockMeshes = [];

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const dirtMat = new THREE.MeshLambertMaterial({ color: 0x5e3c16 });
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const nestMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });

  // Render a Y-slice around the current player focus for performance
  const focusY = Math.floor(state.colonies[0]?.player?.y ?? 0);
  const yRange = 2;

  for (let x = 0; x < WORLD_X_MAX; x++) {
    for (let y = Math.max(0, focusY - yRange); y < Math.min(WORLD_Y_MAX, focusY + yRange); y++) {
      for (let z = 0; z < WORLD_Z_MAX; z++) {
        const block = getBlockAt(x, y, z);
        if (!block) continue;
        let mat = null;
        if (isTileType(block, TILE.DIRT)) mat = dirtMat;
        else if (isTileType(block, TILE.ROCK)) mat = rockMat;
        else if (isTileType(block, TILE.NEST)) mat = nestMat;
        if (!mat) continue;

        const mesh = new THREE.Mesh(geometry, mat.clone());
        mesh.position.set(x, -z, y - focusY);
        scene.add(mesh);
        blockMeshes.push(mesh);
      }
    }
  }
}

export function render3D() {
  if (!renderer) return;
  controls.update();
  renderer.render(scene, camera);
}

export function dispose3D() {
  if (renderer) {
    renderer.dispose();
    renderer.domElement.remove();
    renderer = null;
  }
}

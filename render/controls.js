// render/controls.js — Input handling and camera utilities

import {
  TILE_SIZE, WORLD_X_MAX, WORLD_Y_MAX, WORLD_Z_MAX, state
} from '../core.js';

// ─── Camera utilities ──────────────────────────────────────────

export function getScreenBlockSize() {
  return TILE_SIZE * state.viewZoom;
}

export function getVisibleBlocks() {
  const viewportWidth = state.viewportPanel.clientWidth;
  const viewportHeight = state.viewportPanel.clientHeight;
  const blockSize = getScreenBlockSize();
  return {
    width: viewportWidth / blockSize,
    height: viewportHeight / blockSize
  };
}

export function clampCameraToViewBounds() {
  const visible = getVisibleBlocks();
  const sw = visible.width;
  const sh = visible.height;

  if (state.currentView === 'nest') {
    const maxX = Math.max(0, WORLD_X_MAX - sw);
    const maxY = Math.max(0, WORLD_Z_MAX - sh);
    state.camera1X = Math.max(0, Math.min(state.camera1X, maxX));
    state.camera1Y = Math.max(0, Math.min(state.camera1Y, maxY));
  } else {
    const maxX = Math.max(0, WORLD_Y_MAX - sw);
    const maxY = Math.max(0, WORLD_X_MAX - sh);
    state.camera1X = Math.max(0, Math.min(state.camera1X, maxX));
    state.camera1Y = Math.max(0, Math.min(state.camera1Y, maxY));
  }
}

// ─── Input setup ───────────────────────────────────────────────

export function setupInput(inputCanvas) {
  // Keyboard
  document.addEventListener('keydown', e => { state.keys[e.key] = true; });
  document.addEventListener('keyup',   e => { state.keys[e.key] = false; });

  // Wheel pan
  inputCanvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    const scrollSensitivity = 0.1 / state.viewZoom;
    if (e.deltaX !== 0) state.camera1X += e.deltaX * scrollSensitivity;
    if (e.deltaY !== 0) state.camera1Y += e.deltaY * scrollSensitivity;
    clampCameraToViewBounds();
  }, { passive: false });

  // Pointer drag to pan
  let activePointerId = null;
  let pointerStartX = 0, pointerStartY = 0;
  let lastPointerX = 0,  lastPointerY = 0;
  let pointerDragged = false;

  inputCanvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    activePointerId = e.pointerId;
    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    pointerDragged = false;
    if (inputCanvas.setPointerCapture) inputCanvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  inputCanvas.addEventListener('pointermove', function (e) {
    if (activePointerId !== e.pointerId) return;
    const deltaX = e.clientX - lastPointerX;
    const deltaY = e.clientY - lastPointerY;
    if (Math.abs(e.clientX - pointerStartX) + Math.abs(e.clientY - pointerStartY) > 3) {
      pointerDragged = true;
    }
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    const panSensitivity = (e.pointerType === 'mouse') ? 0.08 : 0.06;
    state.camera1X -= deltaX * (panSensitivity / state.viewZoom);
    state.camera1Y -= deltaY * (panSensitivity / state.viewZoom);
    clampCameraToViewBounds();
    e.preventDefault();
  });

  inputCanvas.addEventListener('pointerup', function (e) {
    if (activePointerId !== e.pointerId) return;
    state.suppressNextClick = pointerDragged;
    activePointerId = null;
    pointerDragged = false;
  });

  inputCanvas.addEventListener('pointercancel', function (e) {
    if (activePointerId !== e.pointerId) return;
    activePointerId = null;
    pointerDragged = false;
  });

  // Click-to-move (player 1)
  inputCanvas.addEventListener('click', e => {
    if (state.suppressNextClick) {
      state.suppressNextClick = false;
      return;
    }

    const rect = inputCanvas.getBoundingClientRect();
    let mx = 0, my = 0, mz = 0;

    if (state.currentView === 'nest') {
      const blockSize = getScreenBlockSize();
      mx = (e.clientX - rect.left) / blockSize + state.camera1X;
      my = Math.floor(state.colonies[0].player.y);
      mz = (e.clientY - rect.top) / blockSize + state.camera1Y;
    } else {
      const blockSize = getScreenBlockSize();
      mx = (e.clientY - rect.top) / blockSize + state.camera1Y;
      my = (e.clientX - rect.left) / blockSize + state.camera1X;
      mz = 0;
    }

    if (mx >= 0 && mx < WORLD_X_MAX && my >= 0 && my < WORLD_Y_MAX && mz >= 0 && mz < WORLD_Z_MAX) {
      state.colonies[0].playerTarget = { x: mx, y: my, z: mz };
    }
  });
}

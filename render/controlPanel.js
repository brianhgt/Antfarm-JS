// render/controlPanel.js — UI bindings (uses jQuery)

import {
  MIN_ZOOM, MAX_ZOOM, ZOOM_STEP,
  WORLD_X_MAX, WORLD_Y_MAX,
  EGG_HATCH_TIME, SPIDER_COOLDOWN,
  state
} from '../core.js';
import { resizeCanvasesToViewport, clearDebug, switchTo2D } from './render2D.js';
import { clampCameraToViewBounds } from './controls.js';
import { init3DView, dispose3D, switchTo3D } from './render3D.js';

let els = {};

export function initControlPanel(jq) {
  // Stats DOM elements
  els = {
    fps:        document.getElementById('fpsStat'),
    zoom:       document.getElementById('zoomStat'),
    ants:       document.getElementById('antsStat'),
    antDeaths:  document.getElementById('antDeathsStat'),
    workers:    document.getElementById('workersStat'),
    soldiers:   document.getElementById('soldiersStat'),
    spiders:    document.getElementById('spidersStat'),
    food:       document.getElementById('foodStat'),
  };

  // Mini-map canvas (if present)
  const miniCanvasEl = document.getElementById('miniMap');
  if (miniCanvasEl) {
    state.miniMapCanvas = miniCanvasEl;
    state.miniMapCtx = (miniCanvasEl.getContext) ? miniCanvasEl.getContext('2d') : null;
    if (state.miniMapCtx) {
      state.miniMapCtx.clearRect(0, 0, miniCanvasEl.width, miniCanvasEl.height);
    }
  }

  // Panel expand / collapse
  let panelExpanded = false;
  const optionsPanel = jq('#optionsPanel');
  const optionsToggleButton = jq('#btn2');

  optionsToggleButton.click(function () {
    panelExpanded = !panelExpanded;
    if (panelExpanded) {
      optionsPanel.addClass('expanded');
      optionsToggleButton.text('\u2716');   // ✖
    } else {
      optionsPanel.removeClass('expanded');
      optionsToggleButton.text('\u2699\uFE0F'); // ⚙️
    }
  });

  // ── Controls ──

  jq('#showPathsCheck').on('change', function () {
    clearDebug();
    state.showDebugPaths = jq(this).is(':checked');
  });

  jq('#maxEntitiesSlider').on('input', function () {
    state.maxEntities = parseInt(jq(this).val());
    jq('#maxEntitiesValue').text(state.maxEntities);
  });

  jq('#numSpidersSlider').on('input', function () {
    state.numSpiders = parseInt(jq(this).val());
    jq('#numSpidersValue').text(state.numSpiders);
    while (state.spiders.length < state.numSpiders) {
      state.spiders.push({
        x: Math.random() * WORLD_X_MAX,
        y: Math.random() * WORLD_Y_MAX,
        z: 0, target: null, path: null, pathIndex: 0,
        timer: EGG_HATCH_TIME, cooldownTimer: SPIDER_COOLDOWN
      });
    }
    while (state.spiders.length > state.numSpiders) state.spiders.pop();
  });

  jq('#foodAmountSlider').on('input', function () {
    state.foodSpawnAmount = parseInt(jq(this).val());
    jq('#foodAmountValue').text(state.foodSpawnAmount);
  });

  jq('#foodFrequencySlider').on('input', function () {
    const value = parseInt(jq(this).val());
    jq('#foodFrequencyValue').text(value);
    state.foodSpawnInterval = value;
    jq('#foodFrequencySecs').text(value.toFixed(1));
  });

  // View toggle
  jq('#viewToggle').on('click', function () {
    if (state.currentView === 'nest') {
      state.currentView = 'overworld';
      jq(this).text('\uD83C\uDFDB\uFE0F');  // 🏛️
    } else {
      state.currentView = 'nest';
      state.camera1Y = 0;
      state.camera1X = 0;
      jq(this).text('\uD83D\uDCE1');         // 📡
    }
  });

  // Zoom buttons
  jq('#btn3').on('click', function () {
    state.viewZoom = Math.max(MIN_ZOOM, +(state.viewZoom - ZOOM_STEP).toFixed(2));
    resizeCanvasesToViewport();
    clampCameraToViewBounds();
  });

  jq('#btn4').on('click', function () {
    state.viewZoom = Math.min(MAX_ZOOM, +(state.viewZoom + ZOOM_STEP).toFixed(2));
    resizeCanvasesToViewport();
    clampCameraToViewBounds();
  });

  jq('#btn5').on('click', async function () {
    if (state.renderMode === '2d') {
      state.renderMode = '3d';
      const container = document.createElement('div');
      container.id = 'view3D';
      state.viewportPanel.appendChild(container);
      await switchTo3D(container);
      jq(this).text('2D');
    } else {
      state.renderMode = '2d';
      dispose3D();
      switchTo2D();
      jq(this).text('3D');
    }
  });
}

export function updateStats(fps, zoom, totalAnts, antDeaths, workersCount, soldiersCount, spidersCount, foodCount) {
  if (els.fps)       els.fps.textContent       = Math.round(fps).toString();
  if (els.zoom)      els.zoom.textContent      = `${Math.round(zoom * 100)}%`;
  if (els.ants)      els.ants.textContent      = totalAnts.toString();
  if (els.antDeaths) els.antDeaths.textContent = antDeaths.toString();
  if (els.workers)   els.workers.textContent   = workersCount.toString();
  if (els.soldiers)  els.soldiers.textContent  = soldiersCount.toString();
  if (els.spiders)   els.spiders.textContent   = spidersCount.toString();
  if (els.food)      els.food.textContent      = foodCount.toString();
}

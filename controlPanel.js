var jq = jQuery.noConflict();

jq(function() {
  // ========== OPTIONS PANEL SETUP ==========
  let panelExpanded = false;
  const optionsPanel = jq('#optionsPanel');
  const optionsToggleButton = jq('#btn2');
  const panelContent = jq('#panelContent');
  const fpsStatEl = document.getElementById('fpsStat');
  const zoomStatEl = document.getElementById('zoomStat');
  const antsStatEl = document.getElementById('antsStat');
  const antDeathsStatEl = document.getElementById('antDeathsStat');
  const workersStatEl = document.getElementById('workersStat');
  const soldiersStatEl = document.getElementById('soldiersStat');
  const spidersStatEl = document.getElementById('spidersStat');
  const foodStatEl = document.getElementById('foodStat');
  let fpsSmoothed = 60;

  // Panel expand/collapse
  optionsToggleButton.click(function() {
    panelExpanded = !panelExpanded;
    if (panelExpanded) {
      optionsPanel.addClass('expanded');
      optionsToggleButton.text('✖');
    } else {
      optionsPanel.removeClass('expanded');
      optionsToggleButton.text('⚙️');
    }
  });

  // ==========================================

  // Connect option panel controls
  jq('#showPathsCheck').on('change', function() {
    clearDebug(dbgCtx);
    showDebugPaths = jq(this).is(':checked');
  });

  jq('#maxEntitiesSlider').on('input', function() {
    maxEntities = parseInt(jq(this).val());
    jq('#maxEntitiesValue').text(maxEntities);
  });

  jq('#numSpidersSlider').on('input', function() {
    numSpiders = parseInt(jq(this).val());
    jq('#numSpidersValue').text(numSpiders);
    // Adjust spider array
    while (spiders.length < numSpiders) {
      spiders.push({ x: Math.random() * WORLD_X_MAX, y: Math.random() * WORLD_Y_MAX, z: 0, target: null, path: null, pathIndex: 0, timer: EGG_HATCH_TIME, cooldownTimer: SPIDER_COOLDOWN });
    }
    while (spiders.length > numSpiders) {
      spiders.pop();
    }
  });

  jq('#foodAmountSlider').on('input', function() {
    foodSpawnAmount = parseInt(jq(this).val());
    jq('#foodAmountValue').text(foodSpawnAmount);
  });

  jq('#foodFrequencySlider').on('input', function() {
    let value = parseInt(jq(this).val());
    jq('#foodFrequencyValue').text(value);
    foodSpawnInterval = value;
    jq('#foodFrequencySecs').text(value.toFixed(1));
  });

  // Handle view toggle between nest and overworld
  jq('#viewToggle').on('click', function() {
    if (primaryViewport.view === 'nest') {
      primaryViewport.view = 'overworld';
      jq(this).text('🏛️');
    } else {
      primaryViewport.view = 'nest';
      primaryViewport.cameraY = 0; // reset vertical camera offset when switching back to nest view
      primaryViewport.cameraX = 0; // reset horizontal camera offset when switching back to nest view
      jq(this).text('📡');
    }
  });

  jq('#btn3').on('click', function() {
    viewZoom = Math.max(MIN_ZOOM, +(viewZoom - ZOOM_STEP).toFixed(2));
    resizeCanvasesToViewport();
    clampCameraToViewBounds();
  });

  jq('#btn4').on('click', function() {
    viewZoom = Math.min(MAX_ZOOM, +(viewZoom + ZOOM_STEP).toFixed(2));
    resizeCanvasesToViewport();
    clampCameraToViewBounds();
  });

  // Function to update stats
  window.updateStats = function(fps, zoom, totalAnts, antDeaths, workersCount, soldiersCount, spidersCount, foodCount) {
    if (fpsStatEl) fpsStatEl.textContent = Math.round(fps).toString();
    if (zoomStatEl) zoomStatEl.textContent = `${Math.round(zoom * 100)}%`;
    if (antsStatEl) antsStatEl.textContent = totalAnts.toString();
    if (antDeathsStatEl) antDeathsStatEl.textContent = antDeaths.toString();
    if (workersStatEl) workersStatEl.textContent = workersCount.toString();
    if (soldiersStatEl) soldiersStatEl.textContent = soldiersCount.toString();
    if (spidersStatEl) spidersStatEl.textContent = spidersCount.toString();
    if (foodStatEl) foodStatEl.textContent = foodCount.toString();
  };
});

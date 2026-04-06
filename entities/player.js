// entities/player.js — Player update logic

import {
  TILE, ANT_TYPE, PLAYER_SPEED,
  WORLD_X_MAX, WORLD_Y_MAX, WORLD_Z_MAX,
  state
} from '../core.js';
import {
  isTileType, isDiggableTile, getBlockAt, setBlock, get3dHash
} from '../util/util.js';
import { damageTileAt, depositAlarmPheromoneIfThreatened, depositPheromone } from '../systems/physics.js';
import { spawnEggNearNest } from '../systems/ai.js';

function updatePlayerPheromoneTrail(player, colonyIndex) {
  const tx = Math.floor(player.x);
  const ty = Math.floor(player.y);
  const tz = Math.floor(player.z);
  const tileKey = get3dHash(tx, ty, tz);

  if (player.lastPheromoneTile === tileKey) return;
  player.lastPheromoneTile = tileKey;

  if (player.carrying === TILE.FOOD) {
    depositPheromone('trail', colonyIndex, tx, ty, tz);
  } else if (!player.carrying) {
    depositPheromone('footprint', colonyIndex, tx, ty, tz);
  }
}

function updatePlayerAlarmPheromone(player, colonyIndex) {
  const tx = Math.floor(player.x);
  const ty = Math.floor(player.y);
  const tz = Math.floor(player.z);
  const tileKey = get3dHash(tx, ty, tz);

  if (player.lastAlarmPheromoneTile === tileKey) return;
  if (depositAlarmPheromoneIfThreatened(colonyIndex, tx, ty, tz)) {
    player.lastAlarmPheromoneTile = tileKey;
  }
}

export function updatePlayers(delta) {
  const { keys } = state;
  const p1Colony = state.colonies[0];
  const p2Colony = state.colonies[1];

  // ── Player 1 – WASD ──
  if (p1Colony && p1Colony.player) {
    let dx = 0, dy = 0, dz = 0;
    if (state.currentView === 'nest') {
      if (keys['w']) dz -= PLAYER_SPEED;
      if (keys['s']) dz += PLAYER_SPEED;
      if (keys['a']) dx -= PLAYER_SPEED;
      if (keys['d']) dx += PLAYER_SPEED;
    } else {
      if (keys['w']) dx -= PLAYER_SPEED;
      if (keys['s']) dx += PLAYER_SPEED;
      if (keys['a']) dy -= PLAYER_SPEED;
      if (keys['d']) dy += PLAYER_SPEED;
    }

    const p1 = p1Colony.player;
    p1.x = Math.max(0, Math.min(WORLD_X_MAX - 1, p1.x + dx * delta));
    p1.y = Math.max(0, Math.min(WORLD_Y_MAX - 1, p1.y + dy * delta));
    p1.z = Math.max(0, Math.min(WORLD_Z_MAX - 1, p1.z + dz * delta));

    // Pickup / drop with 'e'
    if (keys['e']) {
      keys['e'] = false;
      const tx = Math.floor(p1.x), ty = Math.floor(p1.y), tz = Math.floor(p1.z);
      const block = getBlockAt(tx, ty, tz);
      if (!p1.carrying) {
        if (isTileType(block, TILE.FOOD) || isTileType(block, TILE.EGG)) {
          p1.carrying = getBlockAt(tx, ty, tz);
          setBlock(tx, ty, tz, TILE.EMPTY);
        }
      } else {
        if (isTileType(block, TILE.EMPTY)) {
          setBlock(tx, ty, tz, p1.carrying);
          p1.carrying = null;
        }
      }
    }
  }

  // ── Player 2 – Arrow keys ──
  if (p2Colony && p2Colony.player) {
    let ex = 0, ey = 0, ez = 0;
    if (state.currentView === 'nest') {
      if (keys['ArrowUp'])    ez -= PLAYER_SPEED;
      if (keys['ArrowDown'])  ez += PLAYER_SPEED;
      if (keys['ArrowLeft'])  ex -= PLAYER_SPEED;
      if (keys['ArrowRight']) ex += PLAYER_SPEED;
    } else {
      if (keys['ArrowLeft'])  ey -= PLAYER_SPEED;
      if (keys['ArrowRight']) ey += PLAYER_SPEED;
      if (keys['ArrowUp'])    ex -= PLAYER_SPEED;
      if (keys['ArrowDown'])  ex += PLAYER_SPEED;
    }

    const p2 = p2Colony.player;
    p2.x = Math.max(0, Math.min(WORLD_X_MAX - 1, p2.x + ex * delta));
    p2.y = Math.max(0, Math.min(WORLD_Y_MAX - 1, p2.y + ey * delta));
    p2.z = Math.max(0, Math.min(WORLD_Z_MAX - 1, p2.z + ez * delta));
  }

  // ── Per-colony player interactions ──
  state.colonies.forEach((col, idx) => {
    if (idx > 1 || !col.player) return;

    const player = col.player;

    // Click target movement
    if (col.playerTarget) {
      const ddx = col.playerTarget.x - player.x;
      const ddy = col.playerTarget.y - player.y;
      const ddz = col.playerTarget.z - player.z;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
      if (dist > 0.1) {
        const speed = PLAYER_SPEED * delta;
        player.x += speed * ddx / dist;
        player.y += speed * ddy / dist;
        player.z += speed * ddz / dist;
      } else {
        col.playerTarget = null;
      }
    }

    const tx = Math.floor(player.x), ty = Math.floor(player.y), tz = Math.floor(player.z);

    updatePlayerPheromoneTrail(player, idx);
    updatePlayerAlarmPheromone(player, idx);

    // Dig
    if (isDiggableTile(getBlockAt(tx, ty, tz))) {
      damageTileAt(tx, ty, tz, 10);
    }

    // Pickup egg
    if (!player.carrying && col.eggs.has(get3dHash(tx, ty, tz))) {
      player.carrying = TILE.EGG;
      col.eggs.get(get3dHash(tx, ty, tz)).carry = true;
    }
    // Pickup food
    else if (!player.carrying && state.foods.has(get3dHash(tx, ty, tz))) {
      player.carrying = TILE.FOOD;
      state.foods.delete(get3dHash(tx, ty, tz));
    }

    // Spawn worker at nest
    if (tx === col.nest.x && ty === col.nest.y && tz === col.nest.z && player.carrying) {
      if (player.carrying === TILE.FOOD) { player.score++; spawnEggNearNest(col, ANT_TYPE.WORKER); }
      if (player.carrying === TILE.EGG) {
        col.workers.push({
          x: col.nest.x, y: col.nest.y, z: col.nest.z,
          carrying: null, target: null, path: null, pathIndex: 0,
          colIdx: idx, type: ANT_TYPE.WORKER
        });
      }
      player.carrying = null;
    }

    // Spawn soldier at soldier-spawn
    if (tx === col.nest.sX && ty === col.nest.sY && tz === col.nest.z && player.carrying) {
      if (player.carrying === TILE.FOOD) { player.score++; spawnEggNearNest(col, ANT_TYPE.SOLDIER); }
      if (player.carrying === TILE.EGG) {
        col.soldiers.push({
          x: col.nest.sX, y: col.nest.sY, z: col.nest.z,
          carrying: null, target: null, path: null, pathIndex: 0,
          type: ANT_TYPE.SOLDIER
        });
      }
      player.carrying = null;
    }
  });
}

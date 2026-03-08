// systems/physics.js — Tile damage and food spawning

import { TILE, WORLD_X_MAX, WORLD_Y_MAX, state } from '../core.js';
import { isDiggableTile, getBlockAt, setBlock, get3dHash } from '../util.js';

export function damageTileAt(x, y, z, amount = 10) {
  const tile = getBlockAt(x, y, z);
  if (!isDiggableTile(tile)) return false;
  const nextHp = (tile.hp ?? 0) - amount;
  if (nextHp <= 0) {
    setBlock(x, y, z, TILE.EMPTY);
    return true;
  }
  setBlock(x, y, z, { type: tile.type, hp: nextHp });
  return true;
}

export function spawnFood(delta) {
  state.foodSpawnTimer -= delta;
  if (state.foodSpawnTimer <= 0) {
    state.foodSpawnTimer = state.foodSpawnInterval;
    for (let i = 0; i < state.foodSpawnAmount; i++) {
      const fx = Math.floor(Math.random() * WORLD_X_MAX);
      const fy = Math.floor(Math.random() * WORLD_Y_MAX);
      const fz = 0;
      state.foods.set(get3dHash(fx, fy, fz), { x: fx, y: fy, z: fz, carry: false });
    }
  }
}

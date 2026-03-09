// systems/physics.js — Tile damage and food spawning

import * as Core from '../core.js';
import { isDiggableTile, getBlockAt, setBlock, get3dHash } from '../util.js';

export function damageTileAt(x, y, z, amount = 10) {
  const tile = getBlockAt(x, y, z);
  if (!isDiggableTile(tile)) return false;
  const nextHp = (tile.hp ?? 0) - amount;
  if (nextHp <= 0) {
    setBlock(x, y, z, Core.TILE.EMPTY);
    Core.state.viewMapDirty.set(get3dHash(x, y, z), Core.DIRTY_STATE.DELETE);
    return true;
  }
  setBlock(x, y, z, { type: tile.type, hp: nextHp });
  return true;
}

export function spawnFood(delta) {
  Core.state.foodSpawnTimer -= delta;
  if (Core.state.foodSpawnTimer <= 0) {
    Core.state.foodSpawnTimer = Core.state.foodSpawnInterval;
    for (let i = 0; i < Core.state.foodSpawnAmount; i++) {
      const fx = Math.floor(Math.random() * Core.WORLD_X_MAX);
      const fy = Math.floor(Math.random() * Core.WORLD_Y_MAX);
      const fz = 0;
      const fh = get3dHash(fx, fy, fz);
      Core.state.foods.set(fh, { x: fx, y: fy, z: fz, carry: false });
      Core.state.foodDirty.set(fh, Core.DIRTY_STATE.CREATE);
    }
    // overall spawn will have already marked individual tiles dirty
  }
}

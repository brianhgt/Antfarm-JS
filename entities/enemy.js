// entities/enemy.js — Spider AI + death effects

import {
  TILE, TILE_OPEN_SPACE, SPIDER_SPEED, SPIDER_COOLDOWN, SPIDER_CAN_GO_BELOW,
  PATH_TOLERANCE, EGG_HATCH_TIME, WORLD_X_MAX, WORLD_Y_MAX, state
} from '../core.js';
import {
  findPath, getRandomNearbyEmptyTile, setBlock, isMoveOutsideWorld
} from '../util/util.js';

export function getNearestAnt(s) {
  let nearest = null;
  let minDist = Infinity;
  state.colonies.forEach(col => {
    [col.player, ...col.workers].forEach(ant => {
      if (!ant) return;
      const dx = ant.x - s.x;
      const dy = ant.y - s.y;
      const dz = (ant.z ?? 0) - (s.z ?? 0);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < minDist) { minDist = dist; nearest = ant; }
    });
  });
  return nearest ? { ant: nearest, dist: minDist } : null;
}

export function updateSpiders(delta) {
  state.spiders.forEach(s => {
    // Tick timers
    if (s.timer > 0) s.timer -= delta;
    if (s.cooldownTimer > 0) s.cooldownTimer -= delta;

    if (s.timer > 0) return; // still in egg/respawn phase

    const nearest = getNearestAnt(s);
    if (nearest && nearest.dist < 5) {
      if (!s.path || !s.target ||
          s.target.x !== Math.floor(nearest.ant.x) ||
          s.target.y !== Math.floor(nearest.ant.y) ||
          s.target.z !== Math.floor(nearest.ant.z)) {
        s.path = findPath(
          Math.floor(s.x), Math.floor(s.y), Math.floor(s.z),
          Math.floor(nearest.ant.x), Math.floor(nearest.ant.y), Math.floor(nearest.ant.z),
          PATH_TOLERANCE * 1.5
        );
        s.pathIndex = 0;
        s.target = {
          x: Math.floor(nearest.ant.x),
          y: Math.floor(nearest.ant.y),
          z: Math.floor(nearest.ant.z)
        };
      }
    } else {
      if (!s.target) {
        const wander = getRandomNearbyEmptyTile(
          Math.floor(s.x), Math.floor(s.y), Math.floor(s.z), 5
        );
        if (wander) {
          s.target = wander;
          s.path = findPath(
            Math.floor(s.x), Math.floor(s.y), Math.floor(s.z),
            wander.x, wander.y, wander.z,
            PATH_TOLERANCE * 2.0
          );
          s.pathIndex = 0;
        }
      }
    }

    // Move along path
    if (s.path && s.pathIndex < s.path.length) {
      const next = s.path[s.pathIndex];
      if (next.z < TILE_OPEN_SPACE || SPIDER_CAN_GO_BELOW) {
        const dx = next.x + 0.5 - s.x;
        const dy = next.y + 0.5 - s.y;
        const dz = next.z + 0.5 - s.z;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (len < 0.1) {
          s.x = next.x + 0.5;
          s.y = next.y + 0.5;
          s.z = next.z + 0.5;
          s.pathIndex++;
        } else {
          const speed = SPIDER_SPEED * delta;
          const nx = s.x + speed * dx / len;
          const ny = s.y + speed * dy / len;
          const nz = s.z + speed * dz / len;
          if (!isMoveOutsideWorld(nx, ny, nz)) {
            s.x = nx; s.y = ny; s.z = nz;
          }
        }
      }
    } else {
      s.path = null;
      s.target = null;
    }

    // Attack workers
    if (s.cooldownTimer <= 0) {
      state.colonies.forEach(col => {
        for (let j = col.workers.length - 1; j >= 0; j--) {
          const w = col.workers[j];
          if (Math.abs(w.x - s.x) < 0.7 &&
              Math.abs(w.y - s.y) < 0.7 &&
              Math.abs(w.z - s.z) < 0.7) {
            setBlock(Math.floor(w.x), Math.floor(w.y), Math.floor(w.z || 0), TILE.DIRT);
            state.skulls.push({ x: w.x, y: w.y, z: w.z, timer: 300 });
            col.workers.splice(j, 1);
            state.antDeaths++;
            state.spiderScore++;
            s.cooldownTimer = SPIDER_COOLDOWN;
          }
        }
      });
    }
  });
}

export function updateSkulls() {
  for (const sk of state.skulls) sk.timer--;
  while (state.skulls.length && state.skulls[0].timer <= 0) state.skulls.shift();
}

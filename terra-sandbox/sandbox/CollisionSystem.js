const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE){
  throw new Error('CollisionSystem requires THREE to be available globally');
}

function distanceSq2D(a, b){
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export class CollisionSystem {
  constructor({ world = null, crashMargin = 2.5, obstaclePadding = 3 } = {}){
    this.world = world;
    this.crashMargin = crashMargin;
    this.obstaclePadding = obstaclePadding;
    this._result = { crashed: false, reason: null, obstacle: null };
  }

  setWorld(world){
    this.world = world ?? null;
  }

  evaluate(state){
    if (!state || !state.position){
      return { crashed: false, reason: null, obstacle: null };
    }
    const result = this._result;
    result.crashed = false;
    result.reason = null;
    result.obstacle = null;

    const position = state.position;
    const worldHeight = this.world?.getHeightAt?.(position.x, position.y) ?? -Infinity;
    if (position.z <= worldHeight + this.crashMargin){
      result.crashed = true;
      result.reason = 'ground';
      return result;
    }

    if (this.world?.getObstaclesNear){
      const radius = this.obstaclePadding + 6;
      const obstacles = this.world.getObstaclesNear(position.x, position.y, radius) ?? [];
      for (const obstacle of obstacles){
        const top = obstacle.topHeight ?? obstacle.worldPosition?.z ?? worldHeight;
        if (position.z > top + this.crashMargin) continue;
        const padding = (obstacle.radius ?? 0) + this.obstaclePadding;
        const obstaclePos = obstacle.worldPosition ?? { x: 0, y: 0 };
        if (distanceSq2D(position, obstaclePos) <= padding * padding){
          result.crashed = true;
          result.reason = 'obstacle';
          result.obstacle = obstacle;
          return result;
        }
      }
    }

    return result;
  }
}

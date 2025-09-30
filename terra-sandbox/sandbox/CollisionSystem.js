const THREE = (typeof window !== 'undefined' ? window.THREE : globalThis?.THREE) ?? null;
if (!THREE) throw new Error('CollisionSystem requires THREE to be loaded globally');

const TMP_VECTOR = new THREE.Vector3();

function distanceSq2D(ax, ay, bx, by){
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * CollisionSystem
 * - Crashes on ground contact (position.z - groundHeight <= crashMargin)
 * - Crashes on obstacle overlap in X/Y if below obstacle top (with padding)
 * - World API it expects (optional but recommended):
 *    world.getHeightAt(x, y) -> number
 *    world.getObstaclesNear(x, y, radius) -> Array<{ worldPosition: {x,y,z}, topHeight:number, radius:number }>
 *    world.getOriginOffset() -> THREE.Vector3
 */
export class CollisionSystem {
  /**
   * @param {Object} opts
   * @param {Object|null} opts.world
   * @param {number} [opts.crashMargin=2.2]  // vertical margin above ground/obstacle tops
   * @param {number} [opts.obstaclePadding=2.5] // extra horizontal & vertical safety buffer
   * @param {number} [opts.searchRadius=120]    // how far to look for obstacles in XY
   */
  constructor({ world = null, crashMargin = 2.2, obstaclePadding = 2.5, searchRadius = 120 } = {}){
    this.world = world;
    this.crashMargin = crashMargin;
    this.obstaclePadding = obstaclePadding;
    this.searchRadius = searchRadius;
    this._result = { crashed: false, reason: null, obstacle: null, altitude: undefined, groundHeight: undefined };
  }

  setWorld(world){
    this.world = world ?? null;
  }

  /**
   * @param {{ position: {x:number,y:number,z:number} }} planeState
   * @returns {{ crashed:boolean, reason:'ground'|'obstacle'|null, obstacle?:any, altitude?:number, groundHeight?:number }}
   */
  evaluate(planeState){
    const res = this._result;
    res.crashed = false;
    res.reason = null;
    res.obstacle = null;
    res.altitude = undefined;
    res.groundHeight = undefined;

    if (!planeState || !planeState.position) return res;

    const pos = planeState.position;
    const world = this.world;

    // Ground height & altitude
    const groundHeight = world?.getHeightAt?.(pos.x, pos.y);
    const hasGround = Number.isFinite(groundHeight);
    const effectiveGround = hasGround ? groundHeight : -Infinity;
    const altitude = pos.z - effectiveGround;

    res.altitude = altitude;
    res.groundHeight = hasGround ? groundHeight : undefined;

    if (hasGround && altitude <= this.crashMargin){
      res.crashed = true;
      res.reason = 'ground';
      return res;
    }

    // Obstacle checks (requires world + method)
    if (world?.getObstaclesNear){
      const originOffset = world.getOriginOffset?.() ?? TMP_VECTOR.set(0, 0, 0);
      // plane position expressed in the world's obstacle coordinate space
      const planeWorld = TMP_VECTOR.copy(pos).add(originOffset);

      const search = Math.max(this.searchRadius, this.obstaclePadding + 10);
      const obstacles = world.getObstaclesNear(pos.x, pos.y, search) ?? [];

      for (const obstacle of obstacles){
        const oPos = obstacle.worldPosition ?? { x: 0, y: 0, z: 0 };
        const oTop = Number.isFinite(obstacle.topHeight) ? obstacle.topHeight : (oPos.z ?? effectiveGround);
        const horizPadding = (obstacle.radius ?? 0) + this.obstaclePadding;

        // quick XY overlap test
        if (distanceSq2D(planeWorld.x, planeWorld.y, oPos.x, oPos.y) <= horizPadding * horizPadding){
          // vertical clearance check (below the top plus margin)
          if (planeWorld.z <= oTop + this.crashMargin){
            res.crashed = true;
            res.reason = 'obstacle';
            res.obstacle = obstacle;
            return res;
          }
        }
      }
    }

    return res;
  }
}

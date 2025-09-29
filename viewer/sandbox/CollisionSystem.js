import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js';

const TMP_VECTOR = new THREE.Vector3();

export class CollisionSystem {
  constructor({ world, crashMargin = 1.8, obstaclePadding = 2.2 } = {}){
    this.world = world;
    this.crashMargin = crashMargin;
    this.obstaclePadding = obstaclePadding;
  }

  evaluate(planeState){
    if (!planeState || !this.world) return { crashed: false };
    const { position } = planeState;
    const groundHeight = this.world.getHeightAt(position.x, position.y);
    const altitude = position.z - groundHeight;

    if (altitude <= this.crashMargin){
      return {
        crashed: true,
        reason: 'ground',
        altitude,
        groundHeight,
      };
    }

    const originOffset = this.world.getOriginOffset();
    const planeWorld = TMP_VECTOR.copy(position).add(originOffset);

    const obstacles = this.world.getObstaclesNear(position.x, position.y, 120);
    for (const obstacle of obstacles){
      const dx = obstacle.worldPosition.x - planeWorld.x;
      const dy = obstacle.worldPosition.y - planeWorld.y;
      const horizontalSq = dx * dx + dy * dy;
      const radius = obstacle.radius + this.obstaclePadding;
      if (horizontalSq <= radius * radius){
        if (planeWorld.z <= obstacle.topHeight + this.obstaclePadding){
          return {
            crashed: true,
            reason: 'obstacle',
            altitude,
            groundHeight,
            obstacle,
          };
        }
      }
    }

    return { crashed: false, altitude, groundHeight };
  }
}

import * as THREE from 'three'
import { createEnemy } from '@/enemies/stellated-octahedron/behavior'

export function createSpawner(scene: THREE.Scene, player: any, streamer: any){
  let t = 0
  return {
    update(dt:number, stage:number){
      t += dt
      if (t > Math.max(0.6, 2.5 - stage*0.2)){
        t = 0
        const pos = player.group.position.clone().addScaledVector(player.group.getWorldDirection(new THREE.Vector3()), -200)
        pos.x += (Math.random()-0.5)*200
        pos.z += (Math.random()-0.5)*200
        pos.y = streamer.queryHeight(pos.x,pos.z) + 30 + Math.random()*50
        const e = createEnemy(scene, pos)
        e.target = player.group
      }
    }
  }
}

import * as THREE from 'three'
import { createEnemy, updateEnemies } from '@/enemies/stellated-octahedron/behavior'
import { getDifficultyState, onDifficultyChange } from '@/engine/difficulty'

export function createSpawner(scene: THREE.Scene, player: any, streamer: any){
  let t = 0
  let difficulty = getDifficultyState()
  const unsubscribe = onDifficultyChange((next) => {
    //1.- Store the fresh difficulty snapshot to keep cadence, density, and unlocks in sync.
    difficulty = next
  })

  function spawnWave(center: THREE.Vector3){
    //1.- Create one or more adds using offsets that widen with each difficulty unlock.
    const count = difficulty.unlockedAddTypes >= 3 ? 3 : difficulty.unlockedAddTypes === 2 ? 2 : 1
    for (let i = 0; i < count; i++) {
      const spread = 60 + i * 20
      const offset = new THREE.Vector3((Math.random() - 0.5) * spread, 0, (Math.random() - 0.5) * spread)
      const pos = center.clone().add(offset)
      pos.y = streamer.queryHeight(pos.x,pos.z) + 30 + Math.random() * 50
      const enemy = createEnemy(scene, pos, { difficulty })
      enemy.target = player.group
    }
  }

  return {
    update(dt:number, stage:number){
      //1.- Ensure previously spawned enemies pursue their assigned targets before handling cadence logic.
      updateEnemies(scene, dt, difficulty)
      t += dt
      const interval = Math.max(0.45, (2.8 - stage * 0.18) * difficulty.spawnIntervalMultiplier)
      if (t > interval){
        t = 0
        const pos = player.group.position.clone().addScaledVector(player.group.getWorldDirection(new THREE.Vector3()), -220)
        spawnWave(pos)
      }
    },
    dispose(){
      //1.- Release the difficulty subscription when the spawner lifecycle concludes.
      unsubscribe?.()
    }
  }
}

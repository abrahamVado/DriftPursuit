import * as THREE from 'three'

export function createChaseCam(camera: THREE.PerspectiveCamera) {
  const offset = new THREE.Vector3(0, 10, -20)
  const lookOffset = new THREE.Vector3(0, 4, 0)
  const tmp = new THREE.Vector3()
  const lerp = (a:number,b:number,t:number)=>a+(b-a)*t

  return {
    update(dt: number, target: THREE.Object3D) {
      tmp.copy(target.position).add(target.getWorldDirection(new THREE.Vector3()).multiplyScalar(-offset.z))
      tmp.y = target.position.y + offset.y
      camera.position.x = lerp(camera.position.x, tmp.x, 1 - Math.exp(-6*dt))
      camera.position.y = lerp(camera.position.y, tmp.y, 1 - Math.exp(-6*dt))
      camera.position.z = lerp(camera.position.z, tmp.z, 1 - Math.exp(-6*dt))
      const look = new THREE.Vector3().copy(target.position).add(lookOffset)
      camera.lookAt(look)
      camera.fov = 70 + Math.min(20, (target.userData.speed||0)*0.05)
      camera.updateProjectionMatrix()
    }
  }
}

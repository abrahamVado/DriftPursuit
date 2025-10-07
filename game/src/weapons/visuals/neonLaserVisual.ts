import * as THREE from 'three'
import type { NeonLaserState } from '@/weapons/neonLaser'

const DEFAULT_FORWARD = new THREE.Vector3(0, 0, 1)
const TMP_DIRECTION = new THREE.Vector3()
const TMP_POSITION = new THREE.Vector3()
const TMP_QUATERNION = new THREE.Quaternion()

export type NeonLaserVisual = {
  update: (state: NeonLaserState) => void
  dispose: () => void
  readonly beam: THREE.Mesh
}

export function createNeonLaserVisual(scene: THREE.Scene): NeonLaserVisual {
  const material = new THREE.MeshBasicMaterial({
    color: 0x45ffff,
    transparent: true,
    opacity: 0.75,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })

  const geometry = new THREE.BoxGeometry(0.45, 0.45, 1)
  geometry.translate(0, 0, -0.5)

  const beam = new THREE.Mesh(geometry, material)
  beam.visible = false
  scene.add(beam)

  function update(state: NeonLaserState) {
    //1.- Hide the beam outright when the weapon idles so the scene stays clean.
    if (!state.active || state.length <= 0) {
      beam.visible = false
      return
    }

    TMP_DIRECTION.copy(state.direction)
    if (TMP_DIRECTION.lengthSq() === 0) {
      beam.visible = false
      return
    }

    TMP_DIRECTION.normalize()

    beam.visible = true

    //2.- Stretch the mesh along its forward axis to match the sampled range.
    beam.scale.set(1, 1, state.length)

    //3.- Anchor the visual halfway between the muzzle and the measured hit point.
    TMP_POSITION.copy(state.origin).addScaledVector(TMP_DIRECTION, state.length * 0.5)
    beam.position.copy(TMP_POSITION)

    TMP_QUATERNION.setFromUnitVectors(DEFAULT_FORWARD, TMP_DIRECTION)
    beam.quaternion.copy(TMP_QUATERNION)

    //4.- Modulate the glow so attenuation directly affects the rendered opacity.
    const clamped = Math.max(0.2, Math.min(1, state.intensity))
    material.opacity = 0.45 + clamped * 0.4
    material.color.setScalar(0.6 + clamped * 0.4)
  }

  function dispose() {
    //5.- Release GPU buffers when the owning entity despawns to prevent leaks.
    scene.remove(beam)
    geometry.dispose()
    material.dispose()
  }

  return { update, dispose, beam }
}

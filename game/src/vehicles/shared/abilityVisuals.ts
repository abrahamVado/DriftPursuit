import * as THREE from 'three'
import type { SupportAbilityState } from '@/vehicles/shared/supportAbilities'

export type AbilityVisuals = {
  update: (state: SupportAbilityState, parent: THREE.Group) => void
  dispose: (parent: THREE.Group) => void
}

export function createAbilityVisuals(group: THREE.Group): AbilityVisuals {
  const shieldGeometry = new THREE.SphereGeometry(3.5, 24, 16)
  const shieldMaterial = new THREE.MeshBasicMaterial({ color: 0x4cbcff, transparent: true, opacity: 0.28, wireframe: true })
  const shieldMesh = new THREE.Mesh(shieldGeometry, shieldMaterial)
  shieldMesh.visible = false
  group.add(shieldMesh)

  const healGeometry = new THREE.RingGeometry(1.2, 1.9, 32)
  const healMaterial = new THREE.MeshBasicMaterial({ color: 0x66ff9c, side: THREE.DoubleSide, transparent: true, opacity: 0.6 })
  const healMesh = new THREE.Mesh(healGeometry, healMaterial)
  healMesh.rotation.x = Math.PI / 2
  healMesh.position.y = -0.6
  healMesh.visible = false
  group.add(healMesh)

  const dashGeometry = new THREE.ConeGeometry(0.9, 3.6, 20)
  const dashMaterial = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.45 })
  const dashMesh = new THREE.Mesh(dashGeometry, dashMaterial)
  dashMesh.rotation.x = Math.PI
  dashMesh.position.z = 2.2
  dashMesh.visible = false
  group.add(dashMesh)

  const ultimateGeometry = new THREE.TorusGeometry(2.8, 0.18, 16, 36)
  const ultimateMaterial = new THREE.MeshBasicMaterial({ color: 0xff47c2, transparent: true, opacity: 0.5 })
  const ultimateMesh = new THREE.Mesh(ultimateGeometry, ultimateMaterial)
  ultimateMesh.rotation.x = Math.PI / 2
  ultimateMesh.visible = false
  group.add(ultimateMesh)

  function update(state: SupportAbilityState, parent: THREE.Group) {
    //1.- Follow the owning craft so each indicator hugs the vehicle in world space.
    shieldMesh.visible = state.shield.active
    shieldMesh.position.set(0, 0, 0)
    shieldMesh.quaternion.copy(parent.quaternion)

    healMesh.visible = state.heal.cooldownRemainingMs > 0
    healMesh.position.set(0, -0.6, 0)
    healMesh.quaternion.copy(parent.quaternion)

    dashMesh.visible = state.dash.active
    dashMesh.position.set(0, 0, -2.6)
    dashMesh.quaternion.copy(parent.quaternion)

    ultimateMesh.visible = state.ultimate.active
    ultimateMesh.position.set(0, 0, 0)
    ultimateMesh.quaternion.copy(parent.quaternion)
  }

  function dispose(parent: THREE.Group) {
    //2.- Remove helper meshes when the controller shuts down to prevent leaks.
    parent.remove(shieldMesh, healMesh, dashMesh, ultimateMesh)
    shieldGeometry.dispose()
    shieldMaterial.dispose()
    healGeometry.dispose()
    healMaterial.dispose()
    dashGeometry.dispose()
    dashMaterial.dispose()
    ultimateGeometry.dispose()
    ultimateMaterial.dispose()
  }

  return { update, dispose }
}


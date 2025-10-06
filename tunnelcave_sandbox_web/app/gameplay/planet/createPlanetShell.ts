import * as THREE from 'three'

export interface PlanetShellOptions {
  radius: number
  color: THREE.ColorRepresentation
  emissive: THREE.ColorRepresentation
  opacity: number
}

export interface PlanetShell {
  mesh: THREE.Mesh
  dispose: () => void
}

export function createPlanetShell(options: PlanetShellOptions): PlanetShell {
  //1.- Sculpt a hollow sphere that envelopes the battlefield so the cavern reads as a planetary interior.
  const geometry = new THREE.SphereGeometry(options.radius, 48, 32)
  //2.- Tint the shell with a subtle emissive glow and render only the inner faces to avoid occluding the scene.
  const material = new THREE.MeshStandardMaterial({
    color: options.color,
    emissive: new THREE.Color(options.emissive),
    side: THREE.BackSide,
    transparent: true,
    opacity: options.opacity,
    metalness: 0.15,
    roughness: 0.7,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'planet-shell'
  return {
    mesh,
    dispose: () => {
      //3.- Release GPU buffers when the shell is removed so hot reloads do not leak memory.
      geometry.dispose()
      material.dispose()
    },
  }
}


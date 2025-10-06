import * as THREE from 'three'

import { generateRockyPlanetTexture } from './rockyPlanetTexture'

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
  const textureData = generateRockyPlanetTexture({ size: 256 })
  const colorMap = new THREE.DataTexture(textureData.data, textureData.size, textureData.size, THREE.RGBAFormat)
  colorMap.wrapS = THREE.RepeatWrapping
  colorMap.wrapT = THREE.RepeatWrapping
  colorMap.colorSpace = THREE.SRGBColorSpace
  colorMap.format = THREE.RGBAFormat
  colorMap.anisotropy = 4
  colorMap.needsUpdate = true
  //2.- Tint the shell with a subtle emissive glow, wrap a rocky albedo texture, and render only the inner faces to avoid occluding the scene.
  const material = new THREE.MeshStandardMaterial({
    color: options.color,
    emissive: new THREE.Color(options.emissive),
    side: THREE.BackSide,
    transparent: true,
    opacity: options.opacity,
    metalness: 0.12,
    roughness: 0.82,
    map: colorMap,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'planet-shell'
  return {
    mesh,
    dispose: () => {
      //3.- Release GPU buffers when the shell is removed so hot reloads do not leak memory.
      geometry.dispose()
      material.dispose()
      colorMap.dispose()
    },
  }
}


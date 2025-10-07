import * as THREE from 'three'
import type { VehicleKey } from '@/lib/pilotProfile'

export type NameplateProfile = {
  pilotName: string
  vehicleKey: VehicleKey
}

export function createNameplate(profile: NameplateProfile): THREE.Sprite | null {
  //1.- Render a light-weight sprite label when the DOM is available so spectators can identify remote pilots.
  if (typeof document === 'undefined') {
    return null
  }
  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent ?? '' : ''
  if (userAgent.toLowerCase().includes('jsdom')) {
    //2.- Skip label generation entirely during tests so jsdom's incomplete canvas API does not spam the console.
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#ffffff'
  ctx.font = 'bold 40px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(profile.pilotName, canvas.width / 2, canvas.height / 2 - 20)
  ctx.font = '28px sans-serif'
  ctx.fillText(profile.vehicleKey, canvas.width / 2, canvas.height / 2 + 32)
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.position.set(0, 6, 0)
  sprite.scale.set(6, 3, 1)
  sprite.userData.nameplate = { pilotName: profile.pilotName, vehicleKey: profile.vehicleKey }
  //3.- Persist the rendered metadata on the sprite for tests and debugging overlays without re-reading the canvas.
  return sprite
}

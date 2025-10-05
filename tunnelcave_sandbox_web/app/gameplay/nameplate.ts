import * as THREE from 'three'

export interface NameplateSprite {
  //1.- The sprite instance attached to a scene graph node.
  sprite: THREE.Sprite
  //2.- Cleanup callback releasing GPU resources when the parent entity despawns.
  dispose: () => void
}

function drawBackground(context: CanvasRenderingContext2D, width: number, height: number) {
  //1.- Paint a semi-transparent rounded rectangle so the text remains legible atop the scene.
  const radius = 24
  context.fillStyle = 'rgba(12, 18, 32, 0.76)'
  context.beginPath()
  context.moveTo(radius, 0)
  context.lineTo(width - radius, 0)
  context.quadraticCurveTo(width, 0, width, radius)
  context.lineTo(width, height - radius)
  context.quadraticCurveTo(width, height, width - radius, height)
  context.lineTo(radius, height)
  context.quadraticCurveTo(0, height, 0, height - radius)
  context.lineTo(0, radius)
  context.quadraticCurveTo(0, 0, radius, 0)
  context.closePath()
  context.fill()
}

function drawText(context: CanvasRenderingContext2D, label: string, width: number, height: number) {
  //1.- Render the pilot callsign using a bold typeface centred within the badge.
  context.font = 'bold 48px "Segoe UI", sans-serif'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillStyle = '#f6fbff'
  context.fillText(label, width / 2, height / 2)
}

export function createNameplateSprite(rawLabel: string): NameplateSprite {
  //1.- Normalise blank labels so every sprite renders a friendly identifier.
  const label = rawLabel.trim() || 'Squadmate'
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Unable to allocate 2D canvas context for nameplate sprite')
  }
  context.clearRect(0, 0, canvas.width, canvas.height)
  drawBackground(context, canvas.width, canvas.height)
  drawText(context, label, canvas.width, canvas.height)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.center.set(0.5, 0)
  sprite.scale.set(9, 3.2, 1)
  sprite.position.set(0, 4, 0)
  return {
    sprite,
    dispose: () => {
      texture.dispose()
      material.dispose()
    },
  }
}

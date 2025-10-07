import * as THREE from 'three'

export function buildOctahedron() {
  //1.- Compose the main vessel group and enrich it with a sharp octahedral body for visual identity.
  const group = new THREE.Group()
  const baseGeometry = new THREE.OctahedronGeometry(2.5, 1)
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a0e0e,
    roughness: 0.3,
    metalness: 0.7,
    emissive: 0x220000,
    emissiveIntensity: 0.2
  })
  const body = new THREE.Mesh(baseGeometry, bodyMaterial)
  group.add(body)

  //2.- Scatter defensive spikes along the principal axes while injecting smaller offsets for menace.
  const spikeGeometry = new THREE.ConeGeometry(0.3, 1.5, 4)
  const spikeMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.1,
    metalness: 0.9
  })
  const spikePositions = [
    new THREE.Vector3(0, 2.5, 0),
    new THREE.Vector3(0, -2.5, 0),
    new THREE.Vector3(2.5, 0, 0),
    new THREE.Vector3(-2.5, 0, 0),
    new THREE.Vector3(0, 0, 2.5),
    new THREE.Vector3(0, 0, -2.5)
  ]

  spikePositions.forEach((pos) => {
    const spike = new THREE.Mesh(spikeGeometry, spikeMaterial)
    spike.position.copy(pos)
    if (pos.y !== 0) {
      spike.rotation.x = Math.PI / 2
    } else if (pos.x !== 0) {
      spike.rotation.z = Math.PI / 2
    } else {
      spike.rotation.y = Math.PI / 2
    }
    group.add(spike)

    for (let i = 0; i < 2; i++) {
      const smallSpike = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.8, 3), spikeMaterial)
      const offset = new THREE.Vector3()
        .copy(pos)
        .normalize()
        .multiplyScalar(1.8)
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5,
            (Math.random() - 0.5) * 0.5
          )
        )
      smallSpike.position.copy(offset)
      smallSpike.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)
      group.add(smallSpike)
    }
  })

  //3.- Embed emissive eyes and rotational metadata to keep the craft animated and aggressive.
  const eyeGeometry = new THREE.SphereGeometry(0.4, 8, 6)
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xff4500,
    emissive: 0xff4500,
    emissiveIntensity: 0.8,
    roughness: 0,
    metalness: 0
  })
  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial)
  leftEye.position.set(-0.8, 0.5, 1.2)
  group.add(leftEye)
  const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial)
  rightEye.position.set(0.8, 0.5, 1.2)
  group.add(rightEye)
  group.userData = { rotationSpeed: 0.005 }

  //4.- Reset transforms before returning so downstream controllers can re-orient the asset.
  group.position.set(0, 0, 0)
  group.scale.set(1, 1, 1)

  return group
}
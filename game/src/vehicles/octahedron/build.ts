import * as THREE from 'three';

export function buildDangerousEnemy() {
  const group = new THREE.Group();

  // Base body: Refined octahedron with more detail for angular, crystalline menace
  const baseGeometry = new THREE.OctahedronGeometry(2.5, 1); // Detail level 1 for sharper edges
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a0e0e, // Deep crimson red for danger
    roughness: 0.3,
    metalness: 0.7,
    emissive: 0x220000, // Subtle inner glow
    emissiveIntensity: 0.2
  });
  const body = new THREE.Mesh(baseGeometry, bodyMaterial);
  group.add(body);

  // Spikes: Procedural spikes on key vertices for a threatening, porcupine-like silhouette
  const spikeGeometry = new THREE.ConeGeometry(0.3, 1.5, 4);
  const spikeMaterial = new THREE.MeshStandardMaterial({
    color: 0x111111,
    roughness: 0.1,
    metalness: 0.9 // Shiny, blade-like spikes
  });

  // Positions for 6 main spikes (aligned to octahedron axes for symmetry)
  const spikePositions = [
    new THREE.Vector3(0, 2.5, 0),    // Top
    new THREE.Vector3(0, -2.5, 0),   // Bottom
    new THREE.Vector3(2.5, 0, 0),    // Right
    new THREE.Vector3(-2.5, 0, 0),   // Left
    new THREE.Vector3(0, 0, 2.5),    // Forward
    new THREE.Vector3(0, 0, -2.5)    // Backward
  ];

  spikePositions.forEach(pos => {
    const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
    spike.position.copy(pos);
    // Orient spikes outward
    if (pos.y !== 0) {
      spike.rotation.x = Math.PI / 2;
    } else if (pos.x !== 0) {
      spike.rotation.z = Math.PI / 2;
    } else {
      spike.rotation.y = Math.PI / 2;
    }
    group.add(spike);

    // Add smaller secondary spikes for extra menace (offset slightly)
    for (let i = 0; i < 2; i++) {
      const smallSpike = new THREE.Mesh(
        new THREE.ConeGeometry(0.15, 0.8, 3),
        spikeMaterial
      );
      const offset = new THREE.Vector3()
        .copy(pos)
        .normalize()
        .multiplyScalar(1.8)
        .add(new THREE.Vector3(
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5,
          (Math.random() - 0.5) * 0.5
        ));
      smallSpike.position.copy(offset);
      smallSpike.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      ); // Random orientation for chaos
      group.add(smallSpike);
    }
  });

  // Glowing "eyes": Small spheres with emissive material for a predatory stare
  const eyeGeometry = new THREE.SphereGeometry(0.4, 8, 6);
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xff4500, // Fiery orange
    emissive: 0xff4500,
    emissiveIntensity: 0.8,
    roughness: 0,
    metalness: 0
  });
  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(-0.8, 0.5, 1.2);
  group.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  rightEye.position.set(0.8, 0.5, 1.2);
  group.add(rightEye);

  // Subtle rotation animation hook (call in your render loop: enemy.rotation.y += 0.005;)
  group.userData = { rotationSpeed: 0.005 };

  // Center and scale the group
  group.position.set(0, 0, 0);
  group.scale.set(1, 1, 1);

  return group;
}
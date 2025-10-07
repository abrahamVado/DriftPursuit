import * as THREE from 'three';

export function buildArrowhead() {
  const group = new THREE.Group();

  // Materials (reused for efficiency)
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xff7f50,
    roughness: 0.4,
    metalness: 0.6,
    emissive: 0x110500  // Subtle warm glow
  });
  const wingMaterial = new THREE.MeshStandardMaterial({
    color: 0x22272f,
    roughness: 0.8,
    metalness: 0.1
  });
  const engineMaterial = new THREE.MeshStandardMaterial({
    color: 0x0044ff,
    emissive: 0x000022,
    emissiveIntensity: 0.3,
    roughness: 0.2,
    metalness: 0.9
  });

  // Main hull (nose cone)
  const coneGeometry = new THREE.ConeGeometry(1.5, 6, 8);  // Slightly refined for smoother look
  coneGeometry.rotateX(Math.PI / 2);
  const hull = new THREE.Mesh(coneGeometry, bodyMaterial);
  hull.position.set(0, 0, 3);  // Position forward along Z
  group.add(hull);

  // Fuselage body (cylinder for length)
  const bodyGeometry = new THREE.CylinderGeometry(1.2, 1.2, 8, 12);
  bodyGeometry.rotateZ(Math.PI / 2);  // Align along Z
  const fuselage = new THREE.Mesh(bodyGeometry, bodyMaterial);
  fuselage.position.set(0, 0, -1);  // Centered behind nose
  group.add(fuselage);

  // Main wings (symmetric pair for balance)
  const wingGeometry = new THREE.BoxGeometry(10, 0.2, 2);
  const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
  leftWing.position.set(-5, 0, 0);  // Offset to left side
  leftWing.rotation.set(0, 0, Math.PI / 12);  // Slight upward angle for lift
  group.add(leftWing);

  const rightWing = leftWing.clone();
  rightWing.position.set(5, 0, 0);  // Mirror to right
  rightWing.rotation.set(0, 0, -Math.PI / 12);
  group.add(rightWing);

  // Tail fins (for control surfaces)
  const finGeometry = new THREE.BoxGeometry(0.3, 3, 4);
  const leftFin = new THREE.Mesh(finGeometry, wingMaterial);
  leftFin.position.set(-1.5, 0, -6);  // Rear left
  leftFin.rotation.set(0, 0, Math.PI / 6);  // Angled
  group.add(leftFin);

  const rightFin = leftFin.clone();
  rightFin.position.set(1.5, 0, -6);  // Rear right
  rightFin.rotation.set(0, 0, -Math.PI / 6);
  group.add(rightFin);

  // Engine exhaust (simple cone for rear thruster)
  const engineGeometry = new THREE.ConeGeometry(1, 2, 6);
  engineGeometry.rotateX(-Math.PI / 2);  // Point backward
  const engine = new THREE.Mesh(engineGeometry, engineMaterial);
  engine.position.set(0, 0, -6.5);
  group.add(engine);

  // Optional: Add a point light for engine glow (attach to scene separately if needed)
  // const engineLight = new THREE.PointLight(0x0044ff, 1, 20);
  // engineLight.position.set(0, 0, -6.5);
  // group.add(engineLight);

  // Center the entire model
  group.position.set(0, 0, 0);
  group.scale.set(1, 1, 1);

  group.rotation.y = Math.PI;  // Flips it 180° on Y-axis to face the opposite direction
  return group;
}
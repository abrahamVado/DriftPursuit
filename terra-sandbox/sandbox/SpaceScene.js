import { createRng } from '../world/noiseUtils.js';
import { requireTHREE } from '../shared/threeSetup.js';

const THREE = requireTHREE();

if (!THREE) throw new Error('SpaceScene requires THREE to be available');

const TMP_VECTOR = new THREE.Vector3();

export class SpaceScene {
  constructor({ scene, seed = 928371 } = {}){
    if (!scene) throw new Error('SpaceScene requires a scene reference');
    this.scene = scene;
    this.seed = seed >>> 0;
    this.group = new THREE.Group();
    this.group.name = 'SolarSystemSpace';
    this.scene.add(this.group);
    this.group.visible = false;

    this.sectorSize = 9000;
    this.generatedSectors = new Map();
    this.generatedBodies = [];
    this.orbiters = [];
    this.bodies = [];

    this._rngBase = createRng(this.seed ^ 0x5f3562c3);

    this._buildBackdrop();
    this._buildSolarSystem();
  }

  setVisible(visible){
    this.group.visible = !!visible;
    if (this.sunLight) this.sunLight.visible = !!visible;
    if (this.backdrop) this.backdrop.visible = !!visible;
  }

  update(dt = 0, shipPosition = null){
    const delta = Math.max(0, dt);
    this.orbiters.forEach((orbiter) => {
      orbiter.angle += delta * orbiter.orbitSpeed;
      orbiter.pivot.rotation.z = orbiter.angle;
      if (orbiter.mesh){
        orbiter.mesh.rotation.y += delta * orbiter.spinSpeed;
      }
    });

    if (shipPosition){
      this._populateAround(shipPosition);
    }
  }

  getBodies(){
    this.bodies.length = 0;
    this.orbiters.forEach((orb) => {
      if (!orb.mesh) return;
      const pos = orb.mesh.getWorldPosition(TMP_VECTOR.set(0, 0, 0));
      this.bodies.push({ position: pos.clone(), radius: orb.collisionRadius ?? orb.radius ?? 400, mesh: orb.mesh });
    });
    this.generatedBodies.forEach((body) => {
      this.bodies.push({ position: body.position.clone(), radius: body.radius, mesh: body.mesh });
    });
    return this.bodies;
  }

  _buildBackdrop(){
    const starCount = 2800;
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);
    const rng = this._rngBase;
    const radius = 42000;
    for (let i = 0; i < starCount; i += 1){
      const u = rng();
      const v = rng();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = radius;
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      const twinkle = 0.8 + rng() * 0.2;
      colors[i * 3 + 0] = 0.8 * twinkle;
      colors[i * 3 + 1] = 0.9 * twinkle;
      colors[i * 3 + 2] = twinkle;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({ size: 16, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.82 });
    const stars = new THREE.Points(geometry, material);
    stars.name = 'SpaceBackdropStars';
    this.group.add(stars);
    this.backdrop = stars;
  }

  _buildSolarSystem(){
    const sunGeometry = new THREE.SphereGeometry(620, 48, 48);
    const sunMaterial = new THREE.MeshBasicMaterial({ color: 0xffe4a6, toneMapped: false });
    const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    sunMesh.name = 'CentralSun';
    this.group.add(sunMesh);
    this.sun = sunMesh;

    const glowGeometry = new THREE.SphereGeometry(680, 32, 32);
    const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xfff6c9, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false });
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    glowMesh.name = 'SunGlow';
    this.group.add(glowMesh);

    const sunLight = new THREE.PointLight(0xfff3c2, 3.6, 0, 0.02);
    sunLight.position.set(0, 0, 0);
    sunLight.castShadow = false;
    this.group.add(sunLight);
    this.sunLight = sunLight;

    const planetConfigs = [
      { radius: 2400, size: 540, color: 0x70a9ff, orbitSpeed: 0.06, tilt: 0.18, banding: 0.2 },
      { radius: 3600, size: 680, color: 0xffc58b, orbitSpeed: 0.035, tilt: -0.12, banding: 0.35 },
      { radius: 5200, size: 820, color: 0xa98cff, orbitSpeed: 0.018, tilt: 0.28, banding: 0.42 },
    ];

    planetConfigs.forEach((config, index) => {
      const pivot = new THREE.Object3D();
      pivot.name = `OrbitPivot_${index}`;
      this.group.add(pivot);
      const planet = this._createPlanetMesh(config.size, config.color, { banding: config.banding, tilt: config.tilt });
      planet.position.set(config.radius, 0, config.tilt * config.radius * 0.5);
      pivot.add(planet);
      const initialAngle = this._rngBase() * Math.PI * 2;
      this.orbiters.push({
        mesh: planet,
        pivot,
        angle: initialAngle,
        orbitSpeed: config.orbitSpeed,
        spinSpeed: 0.12 + index * 0.04,
        radius: config.size * 0.5,
        collisionRadius: config.size * 0.62,
      });
    });
  }

  _createPlanetMesh(diameter, baseColor, { banding = 0, tilt = 0 } = {}){
    const geometry = new THREE.SphereGeometry(diameter * 0.5, 48, 48);
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(baseColor),
      roughness: 0.65,
      metalness: 0.05,
      emissive: new THREE.Color(baseColor).multiplyScalar(0.08),
      emissiveIntensity: 0.45,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.rotation.z = tilt;
    if (banding > 0){
      const noise = createRng((this.seed ^ 0x9e3779b9) >>> 0);
      const colors = geometry.attributes.position;
      const vertexCount = colors.count;
      const colorAttr = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i += 1){
        const y = geometry.attributes.position.getY(i) / (diameter * 0.5);
        const shade = 0.9 + Math.sin(y * Math.PI * (1 + banding)) * 0.08 + (noise() - 0.5) * 0.05;
        const c = new THREE.Color(baseColor).multiplyScalar(shade);
        colorAttr[i * 3 + 0] = c.r;
        colorAttr[i * 3 + 1] = c.g;
        colorAttr[i * 3 + 2] = c.b;
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colorAttr, 3));
      material.vertexColors = true;
    }
    mesh.name = 'OrbitingPlanet';
    return mesh;
  }

  _populateAround(position){
    const sectorX = Math.floor(position.x / this.sectorSize);
    const sectorY = Math.floor(position.y / this.sectorSize);
    for (let dx = -1; dx <= 1; dx += 1){
      for (let dy = -1; dy <= 1; dy += 1){
        this._ensureSector(sectorX + dx, sectorY + dy);
      }
    }
  }

  _ensureSector(sx, sy){
    const key = `${sx}:${sy}`;
    if (this.generatedSectors.has(key)) return;
    this.generatedSectors.set(key, true);
    if (Math.abs(sx) <= 1 && Math.abs(sy) <= 1) return; // keep near-sun clear

    const seed = ((sx * 374761393) ^ (sy * 668265263) ^ this.seed) >>> 0;
    const rng = createRng(seed);
    const count = 1 + Math.floor(rng() * 2);
    const baseX = sx * this.sectorSize;
    const baseY = sy * this.sectorSize;
    for (let i = 0; i < count; i += 1){
      const px = baseX + (rng() - 0.5) * this.sectorSize * 0.8;
      const py = baseY + (rng() - 0.5) * this.sectorSize * 0.8;
      const pz = (rng() - 0.5) * 1600;
      const radius = 320 + rng() * 520;
      const color = new THREE.Color().setHSL(rng(), 0.48, 0.55 + rng() * 0.15);
      const planet = this._createPlanetMesh(radius * 2, color.getHex(), { banding: 0.25 + rng() * 0.45, tilt: (rng() - 0.5) * 0.6 });
      planet.position.set(px, py, pz);
      this.group.add(planet);
      this.generatedBodies.push({ mesh: planet, position: planet.position.clone(), radius: radius * 1.05 });
    }
  }
}

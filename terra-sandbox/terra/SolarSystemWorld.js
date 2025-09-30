import { requireTHREE } from '../shared/threeSetup.js';

const THREE = requireTHREE();

function toRadians(value){
  if (!Number.isFinite(value)) return 0;
  return THREE.MathUtils.degToRad(value);
}

function resolveValue(value, fallback){
  return Number.isFinite(value) ? value : fallback;
}

export class SolarSystemWorld {
  constructor({ scene, descriptor = {} } = {}){
    this.scene = scene ?? null;
    this.descriptor = descriptor ?? {};
    this.group = new THREE.Group();
    this.group.name = 'SolarSystemWorld';
    this.originOffset = new THREE.Vector3();
    this.disposables = [];
    this.planets = [];
    this.primaryPlanet = null;
    this._tmpVector = new THREE.Vector3();
    this._elapsed = 0;
    this._lastTime = typeof performance !== 'undefined' ? performance.now() / 1000 : null;

    this.star = this._createStar(this.descriptor.star ?? {});
    if (this.star?.mesh){
      this.group.add(this.star.mesh);
    }

    const planetConfigs = Array.isArray(this.descriptor.planets) && this.descriptor.planets.length
      ? this.descriptor.planets
      : this._createDefaultPlanetConfigs();
    this.planets = planetConfigs
      .map((config, index) => this._createPlanet(config, index))
      .filter(Boolean);
    this.planets.forEach((planet) => {
      if (planet.group) this.group.add(planet.group);
      this._positionPlanet(planet);
    });
    this.primaryPlanet = this.planets[0] ?? null;

    if (this.scene){
      this.scene.add(this.group);
    }
  }

  _createStar(config){
    const radius = resolveValue(config.radius, 820);
    const geometry = new THREE.SphereGeometry(radius, 64, 64);
    const material = new THREE.MeshStandardMaterial({
      color: config.color ?? 0xffd18b,
      emissive: config.emissive ?? 0xffb347,
      emissiveIntensity: resolveValue(config.emissiveIntensity, 2.6),
      roughness: 0.18,
      metalness: 0.12,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = config.name ?? 'SolarCore';
    mesh.castShadow = false;
    mesh.receiveShadow = false;

    const glowGeometry = new THREE.SphereGeometry(radius * 1.4, 48, 48);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: config.glowColor ?? 0xffc974,
      transparent: true,
      opacity: resolveValue(config.glowOpacity, 0.28),
      depthWrite: false,
      side: THREE.BackSide,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    mesh.add(glow);

    const light = new THREE.PointLight(
      config.lightColor ?? 0xfff1cf,
      resolveValue(config.lightIntensity, 3.1),
      resolveValue(config.lightRange, 220000),
      resolveValue(config.lightDecay, 2),
    );
    light.castShadow = false;
    mesh.add(light);

    this.disposables.push(geometry, material, glowGeometry, glowMaterial);

    return { mesh, radius, light };
  }

  _createDefaultPlanetConfigs(){
    return [
      {
        name: 'Aurelia',
        radius: 540,
        orbitRadius: 6400,
        orbitSpeed: 0.028,
        color: 0x5f8dff,
        emissive: 0x274a9f,
        orbitHeight: 220,
      },
      {
        name: 'Verdantia',
        radius: 360,
        orbitRadius: 9400,
        orbitSpeed: 0.021,
        color: 0x7ed38c,
        emissive: 0x2a5c34,
        orbitHeight: -320,
      },
    ];
  }

  _createPlanet(config, index){
    const radius = resolveValue(config.radius, 320 + index * 180);
    const orbitRadius = resolveValue(config.orbitRadius, 5800 + index * 3200);
    const orbitSpeed = resolveValue(config.orbitSpeed, Math.max(0.008, 0.028 - index * 0.004));
    const rotationSpeed = resolveValue(config.rotationSpeed, 0.12 + index * 0.04);
    const orbitHeight = resolveValue(config.orbitHeight, index % 2 === 0 ? 260 : -260);
    const tilt = toRadians(resolveValue(config.orbitTilt, index % 2 === 0 ? 6 : -4));
    const orbitPhase = resolveValue(config.orbitPhase, Math.random() * Math.PI * 2);

    const group = new THREE.Group();
    group.name = config.name ?? `Planet-${index + 1}`;
    const geometry = new THREE.SphereGeometry(radius, 48, 48);
    const material = new THREE.MeshStandardMaterial({
      color: config.color ?? 0x9fb2ff,
      emissive: config.emissive ?? 0x1d213f,
      emissiveIntensity: resolveValue(config.emissiveIntensity, 0.4),
      roughness: resolveValue(config.roughness, 0.62),
      metalness: resolveValue(config.metalness, 0.18),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);

    if (config.ring){
      const ringInner = resolveValue(config.ring.innerRadius, radius * 1.4);
      const ringOuter = resolveValue(config.ring.outerRadius, radius * 2.2);
      const ringGeometry = new THREE.RingGeometry(ringInner, ringOuter, 64);
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: config.ring.color ?? 0xcfd6ff,
        transparent: true,
        opacity: resolveValue(config.ring.opacity, 0.35),
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2 + toRadians(resolveValue(config.ring.tilt, 12));
      ring.receiveShadow = false;
      ring.castShadow = false;
      group.add(ring);
      this.disposables.push(ringGeometry, ringMaterial);
    }

    const atmosphereOpacity = resolveValue(config.atmosphereOpacity, 0.18);
    if (atmosphereOpacity > 0){
      const atmosphereGeometry = new THREE.SphereGeometry(radius * 1.05, 32, 32);
      const atmosphereMaterial = new THREE.MeshBasicMaterial({
        color: config.atmosphereColor ?? material.color.clone().offsetHSL(0, 0, 0.12),
        transparent: true,
        opacity: atmosphereOpacity,
        depthWrite: false,
        side: THREE.BackSide,
      });
      const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
      group.add(atmosphere);
      this.disposables.push(atmosphereGeometry, atmosphereMaterial);
    }

    this.disposables.push(geometry, material);

    return {
      id: config.id ?? `planet-${index + 1}`,
      group,
      mesh,
      radius,
      orbitRadius,
      orbitSpeed,
      orbitHeight,
      orbitAngle: orbitPhase,
      rotationSpeed,
      tilt,
    };
  }

  _positionPlanet(planet){
    if (!planet?.group) return;
    const orbitAngle = Number.isFinite(planet.orbitAngle) ? planet.orbitAngle : 0;
    const orbitRadius = Number.isFinite(planet.orbitRadius) ? planet.orbitRadius : 0;
    const orbitHeight = Number.isFinite(planet.orbitHeight) ? planet.orbitHeight : 0;
    const anchor = this.star?.mesh?.position ?? this.group?.position ?? null;
    const offsetX = Math.cos(orbitAngle) * orbitRadius;
    const offsetY = Math.sin(orbitAngle) * orbitRadius;
    const anchorX = anchor?.x ?? 0;
    const anchorY = anchor?.y ?? 0;
    const anchorZ = anchor?.z ?? 0;
    planet.group.position.set(anchorX + offsetX, anchorY + offsetY, anchorZ + orbitHeight);
  }

  update(){
    const now = typeof performance !== 'undefined' ? performance.now() / 1000 : null;
    let dt = 0;
    if (now != null){
      if (this._lastTime != null){
        dt = Math.min(0.2, Math.max(0, now - this._lastTime));
      }
      this._lastTime = now;
    } else {
      dt = 0.016;
    }
    this._elapsed += dt;

    if (this.star?.mesh){
      this.star.mesh.rotation.y += 0.04 * dt;
    }

    this.planets.forEach((planet) => {
      planet.orbitAngle += planet.orbitSpeed * dt;
      this._positionPlanet(planet);
      planet.group.rotation.y += planet.rotationSpeed * dt;
      if (planet.tilt){
        planet.group.rotation.x = planet.tilt;
      }
    });
  }

  handleOriginShift(){}

  getPrimaryPlanetSpawnPoint(offset = 420){
    const planet = this.primaryPlanet;
    if (!planet?.group) return null;
    const anchorPosition = this.star?.mesh?.position ?? this.group?.position ?? null;
    const direction = planet.group.position.clone();
    if (anchorPosition){
      direction.sub(anchorPosition);
    }
    if (direction.lengthSq() < 1e-6){
      direction.set(0, 1, 0);
    }
    direction.normalize();
    const clearance = Number.isFinite(offset) ? Math.max(0, offset) : 0;
    const distance = (planet.radius ?? 0) + clearance;
    return planet.group.position.clone().addScaledVector(direction, distance);
  }

  getHeightAt(){
    return Number.NaN;
  }

  getOriginOffset(){
    return this.originOffset.clone();
  }

  getObstaclesNear(){
    return [];
  }

  getApproachInfo(position, buffer = Number.POSITIVE_INFINITY){
    if (!position) return null;
    const threshold = Number.isFinite(buffer) ? buffer : Number.POSITIVE_INFINITY;
    let closest = null;

    const bodies = [];
    if (this.star?.mesh){
      bodies.push({
        name: this.star.mesh.name ?? 'Star',
        position: this.star.mesh.position,
        radius: this.star.radius ?? 0,
      });
    }
    this.planets.forEach((planet) => {
      bodies.push({
        name: planet.group.name,
        position: planet.group.position,
        radius: planet.radius,
      });
    });

    bodies.forEach((body) => {
      const distance = this._tmpVector.copy(position).sub(body.position).length();
      const surfaceDistance = distance - (body.radius ?? 0);
      if (!closest || surfaceDistance < closest.surfaceDistance){
        closest = {
          body,
          surfaceDistance,
          centerDistance: distance,
        };
      }
    });

    if (!closest) return null;
    closest.distanceToSurface = closest.surfaceDistance;
    closest.withinThreshold = closest.surfaceDistance <= threshold;
    return closest;
  }

  applyProjectileImpact(){}

  dispose(){
    if (this.scene && this.group){
      this.scene.remove(this.group);
    }
    this.planets.forEach((planet) => {
      if (planet.mesh){
        planet.mesh.geometry?.dispose?.();
        planet.mesh.material?.dispose?.();
      }
      if (planet.group){
        planet.group.clear();
      }
    });
    if (this.star?.mesh){
      this.star.mesh.geometry?.dispose?.();
      this.star.mesh.material?.dispose?.();
      if (this.star.mesh.parent){
        this.star.mesh.parent.remove(this.star.mesh);
      }
    }
    this.disposables.forEach((resource) => {
      resource?.dispose?.();
    });
    this.disposables = [];
    this.planets = [];
    this.primaryPlanet = null;
    this.star = null;
  }
}

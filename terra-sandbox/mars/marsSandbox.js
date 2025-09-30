import { THREE } from './threeLoader.js';
import { MarsPlaneController, createPlaneMesh } from './PlaneController.js';
import { MarsChaseCamera } from './chaseCamera.js';
import { MarsInputManager } from './input.js';
import { MarsProjectileSystem } from './projectiles.js';
import { MarsHUD } from './hud.js';
import { createMarsTerrain, disposeMarsTerrain } from './terrain.js';

function createMulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class MarsSandbox {
  constructor({
    canvas,
    statusLabel,
    altitudeOutput,
    temperatureOutput,
    windOutput,
    speedOutput,
    throttleOutput,
    weaponOutput,
    seedOutput,
  }) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.sunLight = null;
    this.fillLight = null;
    this.surfaceGroup = null;
    this.terrain = null;
    this.seed = null;
    this.rng = null;

    this.vehicle = null;
    this.vehicleMesh = null;
    this.chaseCamera = null;
    this.inputManager = null;
    this.projectiles = null;
    this.hud = new MarsHUD({
      statusLabel,
      altitudeOutput,
      temperatureOutput,
      windOutput,
      speedOutput,
      throttleOutput,
      weaponOutput,
      seedOutput,
    });

    this.animationHandle = null;
    this.weaponColor = new THREE.Color('#ff9d5c');

    this._handleResize = this._handleResize.bind(this);
    this._update = this._update.bind(this);
  }

  initialize(seed) {
    this.seed = typeof seed === 'number' ? seed : this._generateSeed();
    this.rng = createMulberry32(this.seed);
    this.hud.setSeed(this.seed.toString(16).toUpperCase());

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#200a07');
    this.scene.fog = new THREE.FogExp2('#5a2216', 0.00032);

    const aspect = this.canvas.clientWidth / this.canvas.clientHeight || window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 24000);

    const ambient = new THREE.AmbientLight('#784233', 0.36);
    this.scene.add(ambient);

    this.sunLight = new THREE.DirectionalLight('#ffd9a0', 1.35);
    this.sunLight.position.set(-560, 720, 420);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 80;
    this.sunLight.shadow.camera.far = 3600;
    this.sunLight.shadow.camera.left = -1200;
    this.sunLight.shadow.camera.right = 1200;
    this.sunLight.shadow.camera.top = 1200;
    this.sunLight.shadow.camera.bottom = -1200;
    this.scene.add(this.sunLight);

    this.fillLight = new THREE.DirectionalLight('#c06b42', 0.42);
    this.fillLight.position.set(420, 260, -580);
    this.scene.add(this.fillLight);

    const skyGeometry = new THREE.SphereGeometry(6400, 32, 32);
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: false,
      uniforms: {
        topColor: { value: new THREE.Color('#31110d') },
        horizonColor: { value: new THREE.Color('#a14b2e') },
        bottomColor: { value: new THREE.Color('#1c0706') },
      },
      vertexShader: `
        varying float vY;
        void main() {
          vY = normalize(position).y * 0.5 + 0.5;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vY;
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        void main() {
          float upper = smoothstep(0.3, 0.85, vY);
          float lower = smoothstep(0.0, 0.4, vY);
          vec3 col = mix(bottomColor, horizonColor, lower);
          col = mix(col, topColor, upper);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    sky.name = 'marsSky';
    this.scene.add(sky);

    this.surfaceGroup = new THREE.Group();
    this.scene.add(this.surfaceGroup);

    this._buildTerrain();

    this.vehicle = new MarsPlaneController();
    const planeMesh = createPlaneMesh();
    this.vehicle.attachMesh(planeMesh);
    this.vehicle.setAuxiliaryLightsActive(false);
    this.scene.add(planeMesh);
    this.vehicleMesh = planeMesh;

    const sampleHeight = this.terrain?.sampleHeight ?? null;
    const anchorY = 48;
    const startHeight = sampleHeight ? sampleHeight(0, anchorY) + 72 : 120;
    this.vehicle.reset({
      position: new THREE.Vector3(0, anchorY, startHeight),
      yaw: THREE.MathUtils.degToRad(180),
      pitch: THREE.MathUtils.degToRad(4),
      throttle: 0.46,
    });

    this.chaseCamera = new MarsChaseCamera({ camera: this.camera, distance: 68, height: 28, lookAhead: 36, responsiveness: 5.6 });
    this.chaseCamera.follow(this.vehicle);

    this.projectiles = new MarsProjectileSystem({ scene: this.scene });
    this.inputManager = new MarsInputManager({ canvas: this.canvas });

    this.hud.setStatus('Atmospheric surveyor plane systems nominal. Weapons hot.');
    this._updateWeather();
    this._handleResize();
    window.addEventListener('resize', this._handleResize);
  }

  start() {
    if (!this.renderer) {
      throw new Error('MarsSandbox not initialized');
    }
    if (this.animationHandle) return;
    this.clock.start();
    this.animationHandle = this.renderer.setAnimationLoop(this._update);
  }

  stop() {
    if (this.animationHandle) {
      this.renderer.setAnimationLoop(null);
      this.animationHandle = null;
    }
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._handleResize);
    this.inputManager?.dispose?.();
    this.projectiles?.dispose?.();
    this.projectiles = null;
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    disposeMarsTerrain(this.terrain);
    this.terrain = null;
    this.scene = null;
  }

  resetCamera() {
    this.chaseCamera?.snap?.();
    this.hud.setStatus('Camera anchor reset.');
  }

  resetVehicle() {
    if (!this.vehicle) return;
    const sampleHeight = this.terrain?.sampleHeight ?? null;
    const anchorY = 48;
    const ground = sampleHeight ? sampleHeight(0, anchorY) : 0;
    this.vehicle.reset({
      position: new THREE.Vector3(0, anchorY, ground + 72),
      yaw: THREE.MathUtils.degToRad(180),
      pitch: THREE.MathUtils.degToRad(4),
      throttle: 0.46,
    });
    this.chaseCamera?.snap?.();
    this.hud.setStatus('Surveyor plane repositioned at orbit anchor.');
  }

  regenerate(seed) {
    const nextSeed = typeof seed === 'number' ? seed : this._generateSeed();
    this.seed = nextSeed;
    this.rng = createMulberry32(this.seed);
    this.hud.setSeed(this.seed.toString(16).toUpperCase());
    this._buildTerrain();
    if (this.terrain?.sampleHeight) {
      const anchorY = 48;
      const ground = this.terrain.sampleHeight(0, anchorY);
      this.vehicle?.reset({
        position: new THREE.Vector3(0, anchorY, ground + 72),
        yaw: THREE.MathUtils.degToRad(180),
        pitch: THREE.MathUtils.degToRad(4),
        throttle: 0.46,
      });
      this.chaseCamera?.snap?.();
    }
    this._updateWeather();
    this.hud.setStatus('Terrain regenerated. Navigation recalibrated.');
  }

  _buildTerrain() {
    if (this.surfaceGroup && this.surfaceGroup.children.length > 0) {
      for (const child of [...this.surfaceGroup.children]) {
        this.surfaceGroup.remove(child);
      }
    }
    if (this.terrain) {
      disposeMarsTerrain(this.terrain);
      this.terrain = null;
    }
    this.terrain = createMarsTerrain({ seed: this.seed, size: 2000, segments: 256 });
    this.surfaceGroup.add(this.terrain.mesh);
    this.surfaceGroup.add(this.terrain.rockField);
    this.surfaceGroup.add(this.terrain.dustField);
  }

  _updateWeather() {
    if (!this.rng) return;
    const temperature = -70 + this.rng() * 35;
    const gust = 6 + this.rng() * 26;
    this.hud.updateEnvironment({ temperature, wind: gust });
  }

  _handleResize() {
    if (!this.renderer || !this.camera) return;
    const width = this.canvas.clientWidth || window.innerWidth - 340;
    const height = this.canvas.clientHeight || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  _update() {
    const dt = this.clock.getDelta();
    if (!this.vehicle || !this.scene) return;

    this.inputManager?.update?.(dt);
    const inputState = this.inputManager ? this.inputManager.getState() : {};

    if (inputState.toggleNavigationLights) {
      const next = !this.vehicle.areNavigationLightsEnabled();
      this.vehicle.setNavigationLightsEnabled(next);
      this.hud.setStatus(next ? 'Navigation beacons illuminated.' : 'Navigation beacons darkened.');
    }
    if (inputState.toggleAuxiliaryLights) {
      const next = !this.vehicle.auxiliaryLightsEnabled;
      this.vehicle.setAuxiliaryLightsActive(next);
      this.hud.setStatus(next ? 'Auxiliary landing lights engaged.' : 'Auxiliary landing lights offline.');
    }

    const sampleHeight = this.terrain?.sampleHeight
      ? (x, y) => this.terrain.sampleHeight(x, y)
      : null;
    const clampAltitude = (controller, ground) => {
      const minimum = ground + 28;
      if (controller.position.z < minimum) {
        controller.position.z = minimum;
        if (controller.velocity.z < 0) {
          controller.velocity.z = 0;
        }
      }
    };

    this.vehicle.update(dt, inputState, {
      sampleGroundHeight: sampleHeight,
      clampAltitude,
    });

    if (inputState.firing) {
      const shot = this.vehicle.firePrimary();
      if (shot) {
        this.projectiles.fire({ origin: shot.origin, direction: shot.direction, velocity: shot.velocity, life: 4.5, color: this.weaponColor });
      }
    }

    this.projectiles?.update?.(dt);
    this.chaseCamera?.update?.(dt);

    const vehicleState = this.vehicle.getState(sampleHeight);
    const speedKmh = vehicleState.speed * 3.6;
    this.hud.updateVehicle({
      altitude: vehicleState.altitude,
      speed: speedKmh,
      throttle: vehicleState.throttle,
      boost: vehicleState.boost,
      weaponReady: vehicleState.weapon.ready,
      heat: vehicleState.weapon.heat,
    });

    const elapsed = this.clock.elapsedTime;
    if (this.sunLight) {
      const sunRadius = 820;
      const angle = elapsed * 0.03;
      this.sunLight.position.x = Math.cos(angle) * sunRadius;
      this.sunLight.position.z = Math.sin(angle) * sunRadius;
      this.sunLight.position.y = 640 + Math.sin(angle * 0.5) * 120;
    }
    if (this.fillLight) {
      this.fillLight.intensity = 0.36 + Math.sin(elapsed * 0.25) * 0.08;
    }

    if (this.terrain?.dustField) {
      const material = this.terrain.dustField.material;
      material.opacity = 0.6 + Math.sin(elapsed * 0.8) * 0.08;
      const geometry = this.terrain.dustField.geometry;
      const positions = geometry.attributes.position;
      const baseY = geometry.attributes.baseY;
      for (let i = 0; i < positions.count; i += 1) {
        const yIndex = i * 3 + 1;
        const wave = Math.sin(elapsed * 0.6 + i * 0.25) * 0.65;
        positions.array[yIndex] = baseY.array[i] + wave;
      }
      positions.needsUpdate = true;
    }

    this.renderer.render(this.scene, this.camera);
  }

  _generateSeed() {
    if (crypto?.getRandomValues) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0] >>> 0;
    }
    return Math.floor(Math.random() * 0xffffffff);
  }
}

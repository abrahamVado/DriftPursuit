import * as THREE from 'three'

export type TankMode = 'vehicle' | 'planet'

export type TankApi = {
  getMode: () => TankMode
  setMode: (next: TankMode) => TankMode
  update: (dt: number) => void
}

type VehicleHooks = {
  update?: (dt: number, input: { pressed: (code: string) => boolean }) => void
  dispose?: () => void
}

export function buildTank() {
  //1.- Anchor the tank root so both the vehicle and planet modes share a common transform.
  const root = new THREE.Group()
  root.name = 'tank-root'

  //2.- Assemble the tracked vehicle mesh with a simple chassis, turret, and barrel.
  const tank = new THREE.Group()
  tank.name = 'tank-vehicle'
  root.add(tank)

  const hullMaterial = new THREE.MeshStandardMaterial({
    color: 0x32404f,
    emissive: 0x0d1016,
    roughness: 0.55,
    metalness: 0.25,
  })
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0x7fb8ff,
    emissive: 0x1a2c44,
    roughness: 0.35,
    metalness: 0.4,
  })

  const hull = new THREE.Mesh(new THREE.BoxGeometry(8, 2.4, 5.4), hullMaterial)
  hull.name = 'tank-hull'
  hull.position.y = 1.2
  tank.add(hull)

  const turretBase = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1.4, 16), hullMaterial)
  turretBase.name = 'tank-turret-base'
  turretBase.position.set(0, 2.5, 0)
  tank.add(turretBase)

  const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 1.6, 16), accentMaterial)
  turret.name = 'tank-turret'
  turret.rotation.z = Math.PI / 2
  turret.position.set(0, 3.1, 0)
  tank.add(turret)

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 6.5, 12), accentMaterial)
  barrel.name = 'tank-barrel'
  barrel.rotation.z = Math.PI / 2
  barrel.position.set(3.4, 3.1, 0)
  tank.add(barrel)

  function createTrack(side: 'left' | 'right') {
    //1.- Offset each track from the hull and stitch together rollers to suggest suspension detail.
    const track = new THREE.Group()
    track.name = `tank-track-${side}`
    track.position.set(0, 0.6, side === 'left' ? 2.8 : -2.8)

    const belt = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 1.2), hullMaterial)
    belt.rotation.x = Math.PI / 2
    track.add(belt)

    const wheelGeometry = new THREE.CylinderGeometry(0.6, 0.6, 1.2, 12)
    for (let i = 0; i < 5; i += 1) {
      const wheel = new THREE.Mesh(wheelGeometry, accentMaterial)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(-3.2 + i * 1.6, 0, 0)
      track.add(wheel)
    }

    return track
  }

  const leftTrack = createTrack('left')
  const rightTrack = createTrack('right')
  tank.add(leftTrack)
  tank.add(rightTrack)

  //3.- Prepare the alternate planet form so the craft can morph when the transformation hotkey is pressed.
  const planet = new THREE.Group()
  planet.name = 'tank-planet'
  planet.visible = false
  root.add(planet)

  const planetMaterial = new THREE.MeshStandardMaterial({
    color: 0x3a9c6f,
    emissive: 0x103824,
    roughness: 0.65,
    metalness: 0.15,
  })
  const planetGlow = new THREE.PointLight(0x76ffbf, 0.9, 40)
  planetGlow.name = 'tank-planet-glow'
  planetGlow.position.set(0, 1.5, 0)
  planet.add(planetGlow)

  const sphere = new THREE.Mesh(new THREE.SphereGeometry(4.2, 32, 24), planetMaterial)
  sphere.name = 'tank-planet-body'
  planet.add(sphere)

  const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.35, 12, 36), accentMaterial)
  ring.name = 'tank-planet-ring'
  ring.rotation.x = Math.PI / 3
  planet.add(ring)

  //4.- Toggle helpers show or hide the relevant meshes when the active mode changes.
  let mode: TankMode = 'vehicle'
  function showVehicle() {
    tank.visible = true
    planet.visible = false
  }
  function showPlanet() {
    tank.visible = false
    planet.visible = true
  }
  showVehicle()

  //5.- Animate the active components so the chassis feels alive in both configurations.
  let turretPhase = 0
  const api: TankApi = {
    getMode: () => mode,
    setMode: (next) => {
      if (mode === next) {
        return mode
      }
      mode = next
      if (mode === 'vehicle') {
        showVehicle()
      } else {
        showPlanet()
      }
      return mode
    },
    update: (dt) => {
      turretPhase += dt
      if (mode === 'vehicle') {
        turret.rotation.y = Math.sin(turretPhase) * 0.4
        barrel.rotation.y = turret.rotation.y
      } else {
        planet.rotation.y += dt * 0.6
        ring.rotation.z += dt * 0.3
      }
    },
  }

  //6.- Bridge the vehicle with the shared player controller so keyboard input can trigger mode swaps.
  const vehicleHooks: VehicleHooks = {
    update: (dt, input) => {
      if (input.pressed('Equal') || input.pressed('NumpadAdd')) {
        api.setMode('planet')
      } else if (input.pressed('Minus') || input.pressed('NumpadSubtract')) {
        api.setMode('vehicle')
      }
      api.update(dt)
    },
  }

  root.userData.tank = api
  root.userData.vehicleHooks = vehicleHooks

  //7.- Return the fully prepared mesh so callers can attach it to the player anchor immediately.
  return root
}

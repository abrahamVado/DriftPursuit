import * as THREE from 'three'

export type TransformerMode = 'robot' | 'plane'

export type TransformerApi = {
  getMode: () => TransformerMode
  setMode: (next: TransformerMode) => TransformerMode
  toggleMode: () => TransformerMode
  update: (dt: number) => void
}

export function buildTransformer() {
  //1.- Compose the root group that will hold both the humanoid and plane configurations.
  const root = new THREE.Group()
  root.name = 'transformer-root'

  //2.- Prepare shared materials so the mech keeps a cohesive palette across modes.
  const chassisMaterial = new THREE.MeshStandardMaterial({
    color: 0x2e5cff,
    emissive: 0x0b1533,
    roughness: 0.35,
    metalness: 0.65
  })
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd166,
    emissive: 0x332100,
    roughness: 0.4,
    metalness: 0.45
  })
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x9ad1ff,
    emissive: 0x122944,
    roughness: 0.12,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85
  })

  //3.- Assemble the humanoid mode with articulated limbs anchored around the origin.
  const robot = new THREE.Group()
  robot.name = 'transformer-robot'
  root.add(robot)

  const torso = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.2, 1.4), chassisMaterial)
  torso.name = 'transformer-torso'
  torso.position.y = 2.4
  robot.add(torso)

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.2), glassMaterial)
  cockpit.name = 'transformer-cockpit'
  cockpit.position.set(0, 3.5, 0.2)
  robot.add(cockpit)

  const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1, 1.1), chassisMaterial)
  head.name = 'transformer-head'
  head.position.set(0, 4.5, 0)
  robot.add(head)

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 0.6), accentMaterial)
  backpack.name = 'transformer-backpack'
  backpack.position.set(0, 2.3, -0.9)
  robot.add(backpack)

  function createArm(side: 'left' | 'right') {
    //1.- Place a pivot at the shoulder so walk animations can swing the arm naturally.
    const arm = new THREE.Group()
    arm.name = `transformer-${side}-arm`
    arm.position.set(side === 'left' ? -1.8 : 1.8, 2.6, 0)

    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1, 1.2), accentMaterial)
    shoulder.position.set(0, 0.2, 0)
    arm.add(shoulder)

    const limb = new THREE.Mesh(new THREE.BoxGeometry(0.8, 3, 1), chassisMaterial)
    limb.position.y = -1.6
    arm.add(limb)

    const forearm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 2.2, 0.9), accentMaterial)
    forearm.position.y = -2.7
    arm.add(forearm)

    return arm
  }

  const leftArm = createArm('left')
  const rightArm = createArm('right')
  robot.add(leftArm)
  robot.add(rightArm)

  function createLeg(side: 'left' | 'right') {
    //1.- Mount the leg at hip height and layer blocks to suggest articulated joints.
    const leg = new THREE.Group()
    leg.name = `transformer-${side}-leg`
    leg.position.set(side === 'left' ? -0.8 : 0.8, 0.8, 0)

    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.9, 3.2, 1.1), chassisMaterial)
    thigh.position.y = -1.6
    leg.add(thigh)

    const knee = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.8, 1.05), accentMaterial)
    knee.position.y = -2.6
    leg.add(knee)

    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.85, 2.6, 1), chassisMaterial)
    shin.position.y = -3.6
    leg.add(shin)

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.6, 1.6), accentMaterial)
    foot.position.set(0, -4.6, 0.25)
    leg.add(foot)

    return leg
  }

  const leftLeg = createLeg('left')
  const rightLeg = createLeg('right')
  robot.add(leftLeg)
  robot.add(rightLeg)

  const visor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, 0.2), glassMaterial)
  visor.position.set(0, 4.4, 0.6)
  robot.add(visor)

  //4.- Construct the plane mode and keep it hidden until transformation is triggered.
  const plane = new THREE.Group()
  plane.name = 'transformer-plane'
  plane.visible = false
  root.add(plane)

  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.3, 9, 12, 1, false), chassisMaterial)
  fuselage.rotation.z = Math.PI / 2
  fuselage.position.set(0, 2, 0)
  plane.add(fuselage)

  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.1, 3.2, 12), chassisMaterial)
  nose.rotation.x = Math.PI / 2
  nose.position.set(0, 2, 4.6)
  plane.add(nose)

  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 12, 0, Math.PI * 2, 0, Math.PI / 1.8), glassMaterial)
  canopy.rotation.x = Math.PI / 2
  canopy.position.set(0, 2.2, 1.5)
  plane.add(canopy)

  const wingGeometry = new THREE.BoxGeometry(8, 0.25, 2.2)
  const leftWing = new THREE.Mesh(wingGeometry, accentMaterial)
  leftWing.position.set(-3.5, 1.9, 0.6)
  leftWing.rotation.set(THREE.MathUtils.degToRad(2), THREE.MathUtils.degToRad(5), THREE.MathUtils.degToRad(12))
  plane.add(leftWing)

  const rightWing = leftWing.clone()
  rightWing.position.x = 3.5
  rightWing.rotation.z = -rightWing.rotation.z
  rightWing.rotation.y = -rightWing.rotation.y
  plane.add(rightWing)

  const tailPlane = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.2, 1.4), accentMaterial)
  tailPlane.position.set(0, 2.1, -4)
  plane.add(tailPlane)

  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.4, 2.4, 1.1), chassisMaterial)
  tailFin.position.set(0, 3.1, -4.4)
  plane.add(tailFin)

  const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.2, 12), accentMaterial)
  thruster.rotation.z = Math.PI / 2
  thruster.position.set(0, 2, -4.8)
  plane.add(thruster)

  const engineGlow = new THREE.PointLight(0x76b3ff, 1.2, 18)
  engineGlow.position.copy(thruster.position)
  plane.add(engineGlow)

  //5.- Provide helpers that toggle visibility and animate a light walk cycle when in humanoid mode.
  let mode: TransformerMode = 'robot'
  let walkPhase = 0
  const strideAmplitude = THREE.MathUtils.degToRad(18)
  const armAmplitude = THREE.MathUtils.degToRad(12)

  function showRobot() {
    robot.visible = true
    plane.visible = false
  }

  function showPlane() {
    robot.visible = false
    plane.visible = true
    plane.rotation.set(0, Math.PI, 0)
  }

  showRobot()

  const api: TransformerApi = {
    getMode: () => mode,
    setMode: (next) => {
      if (mode === next) {
        return mode
      }
      mode = next
      if (mode === 'robot') {
        showRobot()
      } else {
        showPlane()
      }
      return mode
    },
    toggleMode: () => (mode === 'robot' ? api.setMode('plane') : api.setMode('robot')),
    update: (dt) => {
      if (mode !== 'robot' || !robot.visible) {
        return
      }
      walkPhase += dt * 4
      leftLeg.rotation.x = Math.sin(walkPhase) * strideAmplitude
      rightLeg.rotation.x = -Math.sin(walkPhase) * strideAmplitude
      leftArm.rotation.x = -Math.sin(walkPhase) * armAmplitude
      rightArm.rotation.x = Math.sin(walkPhase) * armAmplitude
    }
  }

  root.userData.transformer = api

  //6.- Return the fully prepared group so the player controller can attach it immediately.
  return root
}

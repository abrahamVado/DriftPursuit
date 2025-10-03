'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

import type { CommandName } from './SimulationControlPanel'

export type ExternalCommand = {
  command: CommandName
  issuedAtMs: number
}

type InputState = {
  throttleKeyboard: boolean
  brakeKeyboard: boolean
  steerKeyboard: -1 | 0 | 1
  throttleCommandUntil: number
  brakeCommandUntil: number
}

type TelemetryState = {
  speedKph: number
  headingDeg: number
  throttleEngaged: boolean
  brakeEngaged: boolean
  steeringLabel: 'Left' | 'Right' | 'Straight'
  rendererReady: boolean
  rendererError: string
}

type VehicleSceneProps = {
  externalCommand?: ExternalCommand
}

const INITIAL_INPUT: InputState = {
  throttleKeyboard: false,
  brakeKeyboard: false,
  steerKeyboard: 0,
  throttleCommandUntil: 0,
  brakeCommandUntil: 0,
}

const INITIAL_TELEMETRY: TelemetryState = {
  speedKph: 0,
  headingDeg: 0,
  throttleEngaged: false,
  brakeEngaged: false,
  steeringLabel: 'Straight',
  rendererReady: false,
  rendererError: '',
}

export default function VehicleScene({ externalCommand }: VehicleSceneProps) {
  //1.- Keep stable references to the canvas element, mutable input state, and vehicle physics.
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const inputRef = useRef<InputState>({ ...INITIAL_INPUT })
  const physicsRef = useRef({
    position: new THREE.Vector3(0, 0.3, 0),
    velocity: 0,
    heading: 0,
  })
  const vehicleRef = useRef<THREE.Group | null>(null)
  //2.- Track the telemetry shown to the player so tests can assert interactive changes.
  const [telemetry, setTelemetry] = useState<TelemetryState>({ ...INITIAL_TELEMETRY })

  //3.- Derive memoized styles for the overlay so rerenders do not allocate new objects.
  const overlayStyle = useMemo<React.CSSProperties>(
    () => ({
      position: 'absolute',
      top: '1rem',
      left: '1rem',
      padding: '0.75rem 1rem',
      background: 'rgba(0, 0, 0, 0.55)',
      color: '#ffffff',
      borderRadius: '0.5rem',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '0.9rem',
      lineHeight: 1.4,
      pointerEvents: 'none',
      maxWidth: '16rem',
    }),
    [],
  )

  //4.- Provide a helper that updates both the mutable input state and the telemetry overlays.
  const updateInputs = (updater: (current: InputState) => InputState) => {
    inputRef.current = updater(inputRef.current)
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const throttleActive =
      inputRef.current.throttleKeyboard || now < inputRef.current.throttleCommandUntil
    const brakeActive = inputRef.current.brakeKeyboard || now < inputRef.current.brakeCommandUntil
    const steeringLabel: TelemetryState['steeringLabel'] =
      inputRef.current.steerKeyboard < 0
        ? 'Left'
        : inputRef.current.steerKeyboard > 0
          ? 'Right'
          : 'Straight'
    setTelemetry((previous) => ({
      ...previous,
      throttleEngaged: throttleActive,
      brakeEngaged: brakeActive,
      steeringLabel,
    }))
  }

  useEffect(() => {
    //1.- Synchronize the keyboard handlers so WASD and arrow keys manipulate throttle, brake, and steering.
    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key.toLowerCase()) {
        case 'arrowup':
        case 'w':
          updateInputs((current) => ({ ...current, throttleKeyboard: true }))
          break
        case 'arrowdown':
        case 's':
          updateInputs((current) => ({ ...current, brakeKeyboard: true }))
          break
        case 'arrowleft':
        case 'a':
          updateInputs((current) => ({ ...current, steerKeyboard: -1 }))
          break
        case 'arrowright':
        case 'd':
          updateInputs((current) => ({ ...current, steerKeyboard: 1 }))
          break
        default:
          break
      }
    }
    const handleKeyUp = (event: KeyboardEvent) => {
      switch (event.key.toLowerCase()) {
        case 'arrowup':
        case 'w':
          updateInputs((current) => ({ ...current, throttleKeyboard: false }))
          break
        case 'arrowdown':
        case 's':
          updateInputs((current) => ({ ...current, brakeKeyboard: false }))
          break
        case 'arrowleft':
        case 'a':
          updateInputs((current) => ({
            ...current,
            steerKeyboard: current.steerKeyboard === -1 ? 0 : current.steerKeyboard,
          }))
          break
        case 'arrowright':
        case 'd':
          updateInputs((current) => ({
            ...current,
            steerKeyboard: current.steerKeyboard === 1 ? 0 : current.steerKeyboard,
          }))
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  useEffect(() => {
    //1.- Apply external throttle and brake commands so the scene reacts to bridge-driven controls.
    if (!externalCommand) {
      return
    }
    if (externalCommand.command === 'throttle') {
      updateInputs((current) => ({ ...current, throttleCommandUntil: externalCommand.issuedAtMs + 750 }))
    }
    if (externalCommand.command === 'brake') {
      updateInputs((current) => ({ ...current, brakeCommandUntil: externalCommand.issuedAtMs + 600 }))
    }
  }, [externalCommand])

  useEffect(() => {
    //1.- Bail out until the canvas has been mounted by React.
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    //2.- Attempt to create the renderer, camera, controls, and scene graph.
    let renderer: THREE.WebGLRenderer | null = null
    let animationFrameId: number | null = null
    let resizeHandler: (() => void) | null = null
    let controls: OrbitControls | null = null
    const scene = new THREE.Scene()
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
      renderer.setPixelRatio(window.devicePixelRatio ?? 1)
      const { clientWidth, clientHeight } = canvas
      renderer.setSize(clientWidth, clientHeight)
      scene.background = new THREE.Color(0x87ceeb)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown WebGL initialization error'
      setTelemetry((previous) => ({ ...previous, rendererReady: false, rendererError: message }))
      return
    }

    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 500)
    camera.position.set(6, 4, 8)
    camera.lookAt(new THREE.Vector3(0, 0.5, 0))

    controls = new OrbitControls(camera, canvas)
    controls.target.set(0, 0.5, 0)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.update()

    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambient)
    const sun = new THREE.DirectionalLight(0xffffff, 0.9)
    sun.position.set(8, 15, 12)
    scene.add(sun)

    const groundGeometry = new THREE.PlaneGeometry(200, 200)
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x2f8f2f })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    const roadGeometry = new THREE.PlaneGeometry(4, 120)
    const roadMaterial = new THREE.MeshLambertMaterial({ color: 0x333333 })
    const road = new THREE.Mesh(roadGeometry, roadMaterial)
    road.rotation.x = -Math.PI / 2
    road.position.set(0, 0.01, 0)
    scene.add(road)

    const vehicle = new THREE.Group()
    vehicleRef.current = vehicle

    const chassisGeometry = new THREE.BoxGeometry(1.8, 0.6, 3.8)
    const chassisMaterial = new THREE.MeshStandardMaterial({ color: 0xff5533, metalness: 0.2, roughness: 0.6 })
    const chassis = new THREE.Mesh(chassisGeometry, chassisMaterial)
    chassis.position.set(0, 0.6, 0)
    chassis.castShadow = true
    vehicle.add(chassis)

    const cabinGeometry = new THREE.BoxGeometry(1.4, 0.5, 1.8)
    const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.2 })
    const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial)
    cabin.position.set(0, 0.95, -0.2)
    vehicle.add(cabin)

    const wheelGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.4, 24)
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.3, roughness: 0.7 })
    const wheelOffsets: Array<[number, number, number]> = [
      [0.8, 0.3, 1.25],
      [-0.8, 0.3, 1.25],
      [0.8, 0.3, -1.25],
      [-0.8, 0.3, -1.25],
    ]
    wheelOffsets.forEach(([x, y, z]) => {
      const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial)
      wheel.rotation.z = Math.PI / 2
      wheel.position.set(x, y, z)
      wheel.castShadow = true
      vehicle.add(wheel)
    })

    scene.add(vehicle)

    const skyGeometry = new THREE.SphereGeometry(300, 32, 32)
    const skyMaterial = new THREE.MeshBasicMaterial({ color: 0x87ceeb, side: THREE.BackSide })
    const sky = new THREE.Mesh(skyGeometry, skyMaterial)
    scene.add(sky)

    const resizeCanvas = () => {
      const { clientWidth, clientHeight } = canvas
      camera.aspect = clientWidth / Math.max(clientHeight, 1)
      camera.updateProjectionMatrix()
      renderer?.setSize(clientWidth, clientHeight)
    }
    resizeCanvas()
    resizeHandler = resizeCanvas
    window.addEventListener('resize', resizeCanvas)

    setTelemetry((previous) => ({ ...previous, rendererReady: true, rendererError: '' }))

    let lastTimestamp = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const animate = (timestamp: number) => {
      animationFrameId = requestAnimationFrame(animate)
      const dt = Math.min((timestamp - lastTimestamp) / 1000, 0.05)
      lastTimestamp = timestamp

      const inputState = inputRef.current
      const throttleActive =
        inputState.throttleKeyboard || timestamp < inputState.throttleCommandUntil
      const brakeActive = inputState.brakeKeyboard || timestamp < inputState.brakeCommandUntil
      const steer = inputState.steerKeyboard

      const physics = physicsRef.current
      const acceleration = throttleActive ? 6 : 0
      const braking = brakeActive ? 8 : 0
      physics.velocity += (acceleration - braking) * dt
      const drag = physics.velocity * 0.85 * dt
      physics.velocity = Math.max(0, physics.velocity - drag)
      if (physics.velocity > 0.01) {
        physics.heading += steer * dt * 0.9
        const forwardX = Math.sin(physics.heading)
        const forwardZ = Math.cos(physics.heading)
        physics.position.x += forwardX * physics.velocity * dt
        physics.position.z += forwardZ * physics.velocity * dt
      }

      if (vehicleRef.current) {
        vehicleRef.current.position.copy(physics.position)
        vehicleRef.current.position.y = 0.1
        vehicleRef.current.rotation.y = physics.heading
      }

      controls?.update()
      renderer?.render(scene, camera)

      setTelemetry((previous) => {
        const normalizedHeading = THREE.MathUtils.euclideanModulo(physics.heading, Math.PI * 2)
        const headingDeg = THREE.MathUtils.radToDeg(normalizedHeading)
        return {
          ...previous,
          speedKph: physics.velocity * 3.6,
          headingDeg,
          throttleEngaged: throttleActive,
          brakeEngaged: brakeActive,
          steeringLabel: steer < 0 ? 'Left' : steer > 0 ? 'Right' : 'Straight',
        }
      })
    }
    animationFrameId = requestAnimationFrame(animate)

    //3.- Clean up GPU resources, handlers, and animation loops when the component unmounts.
    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId)
      }
      window.removeEventListener('resize', resizeCanvas)
      controls?.dispose()
      renderer?.dispose()
      scene.clear()
      vehicleRef.current = null
      setTelemetry((previous) => ({ ...previous, rendererReady: false }))
    }
  }, [])

  //5.- Present the canvas and HUD overlay with live telemetry readouts.
  return (
    <div style={{ position: 'relative', width: '100%', height: '480px', marginTop: '1rem' }}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', borderRadius: '0.75rem' }} />
      <div style={overlayStyle}>
        <p data-testid="speed-readout">Speed: {telemetry.speedKph.toFixed(1)} km/h</p>
        <p data-testid="heading-readout">Heading: {telemetry.headingDeg.toFixed(0)}°</p>
        <p data-testid="throttle-indicator">
          Throttle: {telemetry.throttleEngaged ? 'On' : 'Off'}
        </p>
        <p data-testid="brake-indicator">Brake: {telemetry.brakeEngaged ? 'On' : 'Off'}</p>
        <p data-testid="steer-indicator">Steering: {telemetry.steeringLabel}</p>
        {telemetry.rendererReady ? (
          <p>Controls: Arrow keys or WASD.</p>
        ) : telemetry.rendererError ? (
          <p role="alert">Renderer error: {telemetry.rendererError}</p>
        ) : (
          <p>Initializing renderer…</p>
        )}
      </div>
    </div>
  )
}

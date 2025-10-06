'use client'

import React from 'react'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'

import {
  describeAtmosphere,
  defaultPlanetaryShell,
  PlanetTraveler,
  VehicleFleet,
  blueprintToSnapshot,
  type MovementCommand,
  type SphericalPosition,
  type VehicleBlueprint,
  type VehicleSnapshot,
} from './lib'

interface TelemetrySnapshot {
  position: SphericalPosition
  laps: number
  collidedWithSurface: boolean
  hitAtmosphereCeiling: boolean
  vehicles: VehicleSnapshot[]
}

const initialPosition: SphericalPosition = {
  latitudeDeg: 5,
  longitudeDeg: 45,
  altitude: defaultPlanetaryShell.surfaceRadius + 150,
}

const travelCommand: MovementCommand = {
  headingDeg: 92,
  distance: 4_000,
  climb: 5,
}

const vehicleBlueprints: VehicleBlueprint[] = [
  {
    id: 'scout',
    start: { latitudeDeg: 15, longitudeDeg: 120, altitude: defaultPlanetaryShell.surfaceRadius + 300 },
    command: { headingDeg: 80, distance: 3_000, climb: 3 },
  },
  {
    id: 'freighter',
    start: { latitudeDeg: -10, longitudeDeg: -40, altitude: defaultPlanetaryShell.surfaceRadius + 120 },
    command: { headingDeg: 115, distance: 2_500, climb: -1 },
  },
  {
    id: 'racer',
    start: { latitudeDeg: 25, longitudeDeg: -150, altitude: defaultPlanetaryShell.surfaceRadius + 600 },
    command: { headingDeg: 65, distance: 4_500, climb: 4 },
  },
]

const initialVehicleTelemetry = vehicleBlueprints.map((blueprint) => {
  //1.- Seed the telemetry with blueprint defaults so the sidebar lists craft immediately.
  return blueprintToSnapshot(blueprint)
})

const hasWebGlSupport = (): boolean => {
  //1.- Detect WebGL support defensively so SSR and tests skip renderer setup.
  if (typeof window === 'undefined') {
    return false
  }
  const glConstructor = (window as typeof window & { WebGLRenderingContext?: unknown }).WebGLRenderingContext
  return typeof glConstructor === 'function'
}

//1.- Release GPU resources tied to a vehicle mesh, handling single or multi-material setups.
export const disposeVehicleMesh = (
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>,
) => {
  mesh.geometry.dispose()
  const { material } = mesh
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose())
    return
  }
  material.dispose()
}

const PlanetaryMapPanel = () => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>(() => ({
    position: initialPosition,
    laps: 0,
    collidedWithSurface: false,
    hitAtmosphereCeiling: false,
    vehicles: initialVehicleTelemetry.map((snapshot) => ({
      //2.- Clone snapshot data to keep React state immutable between renders.
      ...snapshot,
      position: { ...snapshot.position },
    })),
  }))

  useEffect(() => {
    const mount = containerRef.current
    if (!mount || !hasWebGlSupport()) {
      return undefined
    }

    //1.- Build the Three.js renderer and mount a canvas that fills the container.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    mount.appendChild(renderer.domElement)

    //2.- Position a perspective camera with a gentle orbital angle showcasing the horizon.
    const camera = new THREE.PerspectiveCamera(38, mount.clientWidth / mount.clientHeight, 1, 10_000_000)
    camera.position.set(0, 900, 1550)
    camera.lookAt(0, 0, 0)

    //3.- Compose the scene with gradient lighting to hint at atmosphere scattering.
    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#031021')
    const hemisphereLight = new THREE.HemisphereLight('#89b4ff', '#021726', 0.9)
    const directionalLight = new THREE.DirectionalLight('#ffddaa', 1.2)
    directionalLight.position.set(3000, 2000, 1000)
    scene.add(hemisphereLight)
    scene.add(directionalLight)

    //4.- Construct the planetary shell meshes to visualise surface and atmosphere limits.
    const planetRadius = 1_400
    const planetGeometry = new THREE.SphereGeometry(planetRadius, 128, 128)
    const planetMaterial = new THREE.MeshStandardMaterial({
      color: '#1b5f5f',
      emissive: '#042326',
      metalness: 0.1,
      roughness: 0.8,
    })
    const planetMesh = new THREE.Mesh(planetGeometry, planetMaterial)
    scene.add(planetMesh)

    const shellScale = planetRadius / defaultPlanetaryShell.surfaceRadius
    const atmosphereGeometry = new THREE.SphereGeometry(defaultPlanetaryShell.atmosphereRadius * shellScale, 128, 128)
    const atmosphereMaterial = new THREE.MeshPhongMaterial({
      color: '#4ec6ff',
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
    })
    const atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial)
    scene.add(atmosphereMesh)

    //5.- Prepare helpers to convert spherical telemetry into cartesian coordinates.
    const traveler = new PlanetTraveler(defaultPlanetaryShell, initialPosition)
    const fleet = new VehicleFleet(defaultPlanetaryShell, vehicleBlueprints)
    const vehicleMeshes = new Map<
      string,
      THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>
    >()

    const toCartesian = (position: SphericalPosition) => {
      const latRad = THREE.MathUtils.degToRad(position.latitudeDeg)
      const lonRad = THREE.MathUtils.degToRad(position.longitudeDeg)
      const radius = position.altitude * shellScale
      const cosLat = Math.cos(latRad)
      return new THREE.Vector3(
        radius * cosLat * Math.cos(lonRad),
        radius * Math.sin(latRad),
        radius * cosLat * Math.sin(lonRad),
      )
    }

    //6.- Spawn simple vehicle meshes that trail the player around the shell.
    const vehicleColors: Record<string, string> = {
      scout: '#ffd166',
      freighter: '#00f5d4',
      racer: '#ff6392',
    }

    for (const blueprint of vehicleBlueprints) {
      const vehicleGeometry = new THREE.ConeGeometry(24, 68, 12)
      const vehicleMaterial = new THREE.MeshStandardMaterial({
        color: vehicleColors[blueprint.id] ?? '#ffffff',
        emissive: '#1a2b3c',
        metalness: 0.3,
        roughness: 0.5,
      })
      const mesh = new THREE.Mesh(vehicleGeometry, vehicleMaterial)
      mesh.rotation.x = Math.PI / 2
      scene.add(mesh)
      const startingPosition = toCartesian(blueprint.start)
      mesh.position.copy(startingPosition)
      vehicleMeshes.set(blueprint.id, mesh)
    }

    let animationFrame = 0
    let disposed = false

    const animate = () => {
      if (disposed) {
        return
      }

      //7.- Step the traveler and companion fleet before rendering the latest frame.
      const result = traveler.move(travelCommand)
      const atmosphere = describeAtmosphere(defaultPlanetaryShell, result.position)
      const vehicleSnapshots = fleet.advance()
      for (const snapshot of vehicleSnapshots) {
        const mesh = vehicleMeshes.get(snapshot.id)
        if (!mesh) {
          continue
        }
        const cartesian = toCartesian(snapshot.position)
        mesh.position.copy(cartesian)
      }
      setTelemetry({
        position: result.position,
        laps: result.laps,
        collidedWithSurface: result.collidedWithSurface,
        hitAtmosphereCeiling: result.hitAtmosphereCeiling || atmosphere.distanceToCeiling === 0,
        vehicles: vehicleSnapshots,
      })

      //8.- Rotate the planet and atmosphere for a gentle sense of drift.
      planetMesh.rotation.y += 0.001
      atmosphereMesh.rotation.y += 0.001

      renderer.render(scene, camera)
      animationFrame = requestAnimationFrame(animate)
    }

    //9.- React to viewport changes so the camera aspect and renderer stay in sync.
    const handleResize = () => {
      if (!containerRef.current) {
        return
      }
      const { clientWidth, clientHeight } = containerRef.current
      camera.aspect = clientWidth / Math.max(clientHeight, 1)
      camera.updateProjectionMatrix()
      renderer.setSize(clientWidth, clientHeight)
    }

    window.addEventListener('resize', handleResize)
    animate()

    return () => {
      //10.- Dispose resources and detach DOM nodes once the panel unmounts.
      disposed = true
      cancelAnimationFrame(animationFrame)
      window.removeEventListener('resize', handleResize)
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      scene.clear()
      planetGeometry.dispose()
      planetMaterial.dispose()
      atmosphereGeometry.dispose()
      atmosphereMaterial.dispose()
      vehicleMeshes.forEach((mesh) => {
        scene.remove(mesh)
        disposeVehicleMesh(mesh)
      })
    }
  }, [])

  const atmosphere = describeAtmosphere(defaultPlanetaryShell, telemetry.position)

  return (
    <aside className="planet-map-panel" data-testid="planet-map-panel">
      <div className="planet-map-canvas" ref={containerRef} />
      <header className="planet-map-header">
        <h2>Planet Sandbox</h2>
        <p>Navigate the orbital shell and monitor atmosphere limits.</p>
      </header>
      <dl className="planet-map-telemetry" data-testid="planet-map-telemetry">
        <div>
          <dt>Latitude</dt>
          <dd>{telemetry.position.latitudeDeg.toFixed(2)}°</dd>
        </div>
        <div>
          <dt>Longitude</dt>
          <dd>{telemetry.position.longitudeDeg.toFixed(2)}°</dd>
        </div>
        <div>
          <dt>Altitude</dt>
          <dd>{(telemetry.position.altitude - defaultPlanetaryShell.surfaceRadius).toFixed(1)} m</dd>
        </div>
        <div>
          <dt>Laps</dt>
          <dd>{telemetry.laps}</dd>
        </div>
        <div>
          <dt>Surface Contact</dt>
          <dd>{telemetry.collidedWithSurface ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt>Ceiling Contact</dt>
          <dd>{telemetry.hitAtmosphereCeiling ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt>Distance to ceiling</dt>
          <dd>{atmosphere.distanceToCeiling.toFixed(1)} m</dd>
        </div>
        <div>
          <dt>Outside breathable band</dt>
          <dd>{atmosphere.outsideBreathableBand ? 'Yes' : 'No'}</dd>
        </div>
      </dl>
      <section className="planet-map-fleet" data-testid="planet-map-fleet">
        <h3>Companion telemetry</h3>
        <ul>
          {telemetry.vehicles.map((vehicle) => (
            <li key={vehicle.id}>
              <span>{vehicle.id}</span>
              <span>
                {vehicle.position.latitudeDeg.toFixed(1)}° / {vehicle.position.longitudeDeg.toFixed(1)}°
              </span>
              <span>{(vehicle.position.altitude - defaultPlanetaryShell.surfaceRadius).toFixed(0)} m</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

export default PlanetaryMapPanel

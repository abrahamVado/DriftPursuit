import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { describeAtmosphere } from '../lib/atmosphere';
import { defaultPlanetaryShell, MovementCommand, SphericalPosition } from '../lib/planetConfig';
import { PlanetTraveler } from '../lib/sphericalNavigator';
import { VehicleBlueprint, VehicleFleet, VehicleSnapshot, blueprintToSnapshot } from '../lib/vehicleFleet';

interface TelemetrySnapshot {
  position: SphericalPosition;
  laps: number;
  collidedWithSurface: boolean;
  hitAtmosphereCeiling: boolean;
  vehicles: VehicleSnapshot[];
}

const initialPosition: SphericalPosition = {
  latitudeDeg: 5,
  longitudeDeg: 45,
  altitude: defaultPlanetaryShell.surfaceRadius + 150
};

const travelCommand: MovementCommand = {
  headingDeg: 92,
  distance: 4_000,
  climb: 5
};

const vehicleBlueprints: VehicleBlueprint[] = [
  {
    id: 'scout',
    start: { latitudeDeg: 15, longitudeDeg: 120, altitude: defaultPlanetaryShell.surfaceRadius + 300 },
    command: { headingDeg: 80, distance: 3_000, climb: 3 }
  },
  {
    id: 'freighter',
    start: { latitudeDeg: -10, longitudeDeg: -40, altitude: defaultPlanetaryShell.surfaceRadius + 120 },
    command: { headingDeg: 115, distance: 2_500, climb: -1 }
  },
  {
    id: 'racer',
    start: { latitudeDeg: 25, longitudeDeg: -150, altitude: defaultPlanetaryShell.surfaceRadius + 600 },
    command: { headingDeg: 65, distance: 4_500, climb: 4 }
  }
];

const initialVehicleTelemetry = vehicleBlueprints.map((blueprint) => {
  //1.- Seed the telemetry list so companion traffic renders before animations tick.
  return blueprintToSnapshot(blueprint);
});

const PlanetSandbox = () => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot>(() => ({
    position: initialPosition,
    laps: 0,
    collidedWithSurface: false,
    hitAtmosphereCeiling: false,
    vehicles: initialVehicleTelemetry.map((snapshot) => ({
      //2.- Clone the prepared vehicle snapshots so component state stays immutable.
      ...snapshot,
      position: { ...snapshot.position }
    }))
  }));

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    //1.- Build the Three.js renderer and hook it into the component container.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);

    //2.- Prepare the orbital camera with a slight tilt to highlight the horizon.
    const camera = new THREE.PerspectiveCamera(38, containerRef.current.clientWidth / containerRef.current.clientHeight, 1, 10_000_000);
    camera.position.set(0, 900, 1550);
    camera.lookAt(0, 0, 0);

    //3.- Compose the scene with atmospheric gradients and a sun light source.
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#031021');

    const hemisphereLight = new THREE.HemisphereLight('#89b4ff', '#021726', 0.9);
    scene.add(hemisphereLight);

    const directionalLight = new THREE.DirectionalLight('#ffddaa', 1.2);
    directionalLight.position.set(3000, 2000, 1000);
    scene.add(directionalLight);

    //4.- Create the planet mesh with layered materials for ocean and terrain.
    const planetRadius = 1_400;
    const planetGeometry = new THREE.SphereGeometry(planetRadius, 128, 128);
    const planetMaterial = new THREE.MeshStandardMaterial({
      color: '#1b5f5f',
      emissive: '#042326',
      metalness: 0.1,
      roughness: 0.8
    });
    const planetMesh = new THREE.Mesh(planetGeometry, planetMaterial);
    scene.add(planetMesh);

    //5.- Add a translucent shell representing the atmospheric ceiling.
    const shellScale = planetRadius / defaultPlanetaryShell.surfaceRadius;
    const atmosphereGeometry = new THREE.SphereGeometry(defaultPlanetaryShell.atmosphereRadius * shellScale, 128, 128);
    const atmosphereMaterial = new THREE.MeshPhongMaterial({
      color: '#4ec6ff',
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    });
    const atmosphereMesh = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
    scene.add(atmosphereMesh);

    //6.- Store the traveler controller so physics updates keep accumulating.
    const traveler = new PlanetTraveler(defaultPlanetaryShell, initialPosition);
    const fleet = new VehicleFleet(defaultPlanetaryShell, vehicleBlueprints);
    const vehicleMeshes = new Map<string, THREE.Object3D>();
    const toCartesian = (position: SphericalPosition) => {
      const latRad = THREE.MathUtils.degToRad(position.latitudeDeg);
      const lonRad = THREE.MathUtils.degToRad(position.longitudeDeg);
      const radius = position.altitude * shellScale;
      const cosLat = Math.cos(latRad);
      return new THREE.Vector3(
        radius * cosLat * Math.cos(lonRad),
        radius * Math.sin(latRad),
        radius * cosLat * Math.sin(lonRad)
      );
    };

    //7.- Introduce vehicle meshes to visualize the companion traffic lanes.
    const vehicleColors: Record<string, string> = {
      scout: '#ffd166',
      freighter: '#00f5d4',
      racer: '#ff6392'
    };

    for (const blueprint of vehicleBlueprints) {
      const vehicleGeometry = new THREE.ConeGeometry(24, 68, 12);
      const vehicleMaterial = new THREE.MeshStandardMaterial({
        color: vehicleColors[blueprint.id] ?? '#ffffff',
        emissive: '#1a2b3c',
        metalness: 0.3,
        roughness: 0.5
      });
      const mesh = new THREE.Mesh(vehicleGeometry, vehicleMaterial);
      mesh.rotation.x = Math.PI / 2;
      scene.add(mesh);
      const startingPosition = toCartesian(blueprint.start);
      mesh.position.copy(startingPosition);
      vehicleMeshes.set(blueprint.id, mesh);
    }

    let animationFrame = 0;

    const animate = () => {
      //8.- Progress the traveler forward and update the telemetry panel.
      const result = traveler.move(travelCommand);
      const atmosphere = describeAtmosphere(defaultPlanetaryShell, result.position);
      const vehicleSnapshots = fleet.advance();
      for (const snapshot of vehicleSnapshots) {
        const mesh = vehicleMeshes.get(snapshot.id);
        if (!mesh) {
          continue;
        }
        const cartesian = toCartesian(snapshot.position);
        mesh.position.copy(cartesian);
      }
      setTelemetry({
        position: result.position,
        laps: result.laps,
        collidedWithSurface: result.collidedWithSurface,
        hitAtmosphereCeiling: result.hitAtmosphereCeiling || atmosphere.distanceToCeiling === 0,
        vehicles: vehicleSnapshots
      });

      //9.- Spin the planet for a sense of motion while keeping the shell aligned.
      planetMesh.rotation.y += 0.001;
      atmosphereMesh.rotation.y += 0.001;

      renderer.render(scene, camera);
      animationFrame = requestAnimationFrame(animate);
    };

    //10.- Ensure the viewport reacts to window resizing for consistent aspect ratios.
    const handleResize = () => {
      if (!containerRef.current) {
        return;
      }
      const { clientWidth, clientHeight } = containerRef.current;
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(clientWidth, clientHeight);
    };

    window.addEventListener('resize', handleResize);
    animate();

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      containerRef.current?.removeChild(renderer.domElement);
      scene.clear();
    };
  }, []);

  const atmosphere = describeAtmosphere(defaultPlanetaryShell, telemetry.position);

  return (
    <section className="sandbox-wrapper">
      <div ref={containerRef} className="canvas-container" />
      <header className="sandbox-header">
        <h1>Planet Sandbox</h1>
        <p>Navigate a spherical world and stay within the atmosphere.</p>
      </header>
      <article className="info-panel">
        <span>
          <strong>Latitude</strong>
          <span>{telemetry.position.latitudeDeg.toFixed(2)}°</span>
        </span>
        <span>
          <strong>Longitude</strong>
          <span>{telemetry.position.longitudeDeg.toFixed(2)}°</span>
        </span>
        <span>
          <strong>Altitude</strong>
          <span>{(telemetry.position.altitude - defaultPlanetaryShell.surfaceRadius).toFixed(1)} m</span>
        </span>
        <span>
          <strong>Laps</strong>
          <span>{telemetry.laps}</span>
        </span>
        <span>
          <strong>Surface Contact</strong>
          <span>{telemetry.collidedWithSurface ? 'Yes' : 'No'}</span>
        </span>
        <span>
          <strong>Ceiling Contact</strong>
          <span>{telemetry.hitAtmosphereCeiling ? 'Yes' : 'No'}</span>
        </span>
        <span>
          <strong>Distance to ceiling</strong>
          <span>{atmosphere.distanceToCeiling.toFixed(1)} m</span>
        </span>
        <span>
          <strong>Outside breathable band</strong>
          <span>{atmosphere.outsideBreathableBand ? 'Yes' : 'No'}</span>
        </span>
        <div className="vehicle-status">
          <strong>Vehicle telemetry</strong>
          <ul>
            {telemetry.vehicles.map((vehicle) => (
              <li key={vehicle.id}>
                <span>{vehicle.id}</span>
                <span>
                  {vehicle.position.latitudeDeg.toFixed(1)}° / {vehicle.position.longitudeDeg.toFixed(1)}°
                </span>
                <span>
                  {(vehicle.position.altitude - defaultPlanetaryShell.surfaceRadius).toFixed(0)} m
                </span>
              </li>
            ))}
          </ul>
        </div>
      </article>
    </section>
  );
};

export default PlanetSandbox;

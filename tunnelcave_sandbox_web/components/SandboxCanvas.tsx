"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { defaultParams } from "../lib/config";

import { computeCameraGoal, type CameraMode } from "../lib/camera";

import { createSimulation, updateSimulation, type SimulationParams } from "../lib/world";
import type { SimulationState } from "../lib/world";
import type { ChunkData } from "../lib/terrain";
import { ControlsOverlay } from "./ControlsOverlay";

interface InputState {
  throttle: number;
  roll: number;
  yaw: number;
  pitch: number;
  boost: boolean;
  resetOrientation: boolean;
}

function buildCraftMesh() {
  const geometry = new THREE.BufferGeometry();
  const vertices = new Float32Array([
    0, 0, 1.5,
    -0.8, 0, -1,
    0.8, 0, -1,
    0, 0.45, -0.5,
    0, -0.45, -0.5
  ]);
  const indices = new Uint16Array([
    0, 1, 3,
    0, 3, 2,
    0, 2, 4,
    0, 4, 1,
    1, 4, 3,
    3, 4, 2,
    2, 1, 3
  ]);
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xf97316,
    flatShading: false,
    metalness: 0.2,
    roughness: 0.6
  });
  return new THREE.Mesh(geometry, material);
}

function createChunkMesh(chunk: ChunkData) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(chunk.positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(chunk.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(chunk.indices, 1));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0x334155,
    flatShading: true,
    side: THREE.DoubleSide
  });
  return new THREE.Mesh(geometry, material);
}

export function SandboxCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<SimulationState | null>(null);
  const rafRef = useRef<number>();

  const inputRef = useRef<InputState>({
    throttle: 0,
    roll: 0,
    yaw: 0,
    pitch: 0,
    boost: false,
    resetOrientation: false
  });

  const [speed, setSpeed] = useState(0);
  const [targetSpeed, setTargetSpeed] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x020617);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);

    const ambient = new THREE.AmbientLight(0xbfdcff, 0.5);
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(30, 60, 25);
    scene.add(ambient, mainLight);

    const craftMesh = buildCraftMesh();
    scene.add(craftMesh);

    const chunkMeshes = new Map<number, THREE.Mesh>();

    const simParams: SimulationParams = {
      sandbox: defaultParams,
      camera: {
        smoothing: 3,
        collisionBuffer: 1.2,
        firstPerson: { forwardOffset: 2.5, heightOffset: 0.25, lookAhead: 60 },
        secondPerson: { followDistance: 6, heightOffset: 1.8, lateralOffset: 0, lookAhead: 55 },
        thirdPerson: { followDistance: 13.5, heightOffset: 4.5, lateralOffset: 0, lookAhead: 70 }
      },
      craftRadius: 2.2
    };

    const simulation = createSimulation(simParams);
    simRef.current = simulation;

    function syncChunks() {
      if (!simRef.current) return;
      for (const [index, chunk] of simRef.current.band.chunks.entries()) {
        if (!chunkMeshes.has(index)) {
          const mesh = createChunkMesh(chunk);
          chunkMeshes.set(index, mesh);
          scene.add(mesh);
        }
      }
      for (const [index, mesh] of chunkMeshes.entries()) {
        if (!simRef.current.band.chunks.has(index)) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else {
            mesh.material.dispose();
          }
          chunkMeshes.delete(index);
        }
      }
    }

    syncChunks();

    let lastTime = performance.now();

    const handleResize = () => {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };

    const applyViewMode = (mode: CameraMode) => {
      if (!simRef.current) return;
      simRef.current.viewMode = mode;
      const goal = computeCameraGoal(
        simRef.current.craft.position,
        simRef.current.craft.forward,
        simRef.current.craft.right,
        simRef.current.craft.up,
        simParams.camera,
        mode,
        simRef.current.currentRingRadius,
        simParams.sandbox.roughAmp
      );
      simRef.current.camera.position = [...goal.position];
      simRef.current.camera.target = [...goal.target];
    };

    const keyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case "ArrowUp":
          inputRef.current.throttle = 1;
          event.preventDefault();
          break;
        case "ArrowDown":
          inputRef.current.throttle = -1;
          event.preventDefault();
          break;
        case "KeyA":
          inputRef.current.roll = -1;
          break;
        case "KeyB":
          inputRef.current.roll = 1;
          break;
        case "KeyW":
          inputRef.current.pitch = 1;
          break;
        case "KeyS":
          inputRef.current.pitch = -1;
          break;
        case "KeyQ":
          inputRef.current.yaw = -1;
          break;
        case "KeyE":
          inputRef.current.yaw = 1;
          break;
        case "Digit1":
          applyViewMode("first");
          break;
        case "Digit2":
          applyViewMode("second");
          break;
        case "Digit3":
          applyViewMode("third");
          break;

        case "ShiftLeft":
        case "ShiftRight":
          inputRef.current.boost = true;
          break;
        case "Space":
          inputRef.current.resetOrientation = true;
          event.preventDefault();
          break;
        default:
          break;
      }
    };

    const keyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case "ArrowUp":
          if (inputRef.current.throttle > 0) inputRef.current.throttle = 0;
          event.preventDefault();
          break;
        case "ArrowDown":
          if (inputRef.current.throttle < 0) inputRef.current.throttle = 0;
          event.preventDefault();
          break;
        case "KeyA":
          if (inputRef.current.roll < 0) inputRef.current.roll = 0;
          break;
        case "KeyB":
          if (inputRef.current.roll > 0) inputRef.current.roll = 0;
          break;
        case "KeyW":
          if (inputRef.current.pitch > 0) inputRef.current.pitch = 0;
          break;
        case "KeyS":
          if (inputRef.current.pitch < 0) inputRef.current.pitch = 0;
          break;
        case "KeyQ":
          if (inputRef.current.yaw < 0) inputRef.current.yaw = 0;
          break;
        case "KeyE":
          if (inputRef.current.yaw > 0) inputRef.current.yaw = 0;
          break;
        case "ShiftLeft":
        case "ShiftRight":
          inputRef.current.boost = false;
          break;
        default:
          break;
      }
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);

    const animate = () => {
      if (!simRef.current) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      const params: SimulationParams = {
        sandbox: simParams.sandbox,
        camera: {
          ...simParams.camera,
          smoothing: inputRef.current.boost ? simParams.camera.smoothing * 1.8 : simParams.camera.smoothing
        },
        craftRadius: simParams.craftRadius
      };
      updateSimulation(
        simRef.current,
        params,
        {
          throttleDelta: inputRef.current.throttle,
          rollDelta: inputRef.current.roll,
          yawDelta: inputRef.current.yaw,
          pitchDelta: inputRef.current.pitch
        },
        dt
      );
      if (inputRef.current.resetOrientation) {
        simRef.current.craft.roll = 0;
        simRef.current.craft.rollRate = 0;
        simRef.current.craft.yaw = 0;
        simRef.current.craft.yawRate = 0;
        simRef.current.craft.pitch = 0;
        simRef.current.craft.pitchRate = 0;
        updateSimulation(
          simRef.current,
          params,
          { throttleDelta: 0, rollDelta: 0, yawDelta: 0, pitchDelta: 0 },
          0
        );
        inputRef.current.resetOrientation = false;
      }
      syncChunks();
      const { craft, camera: cam } = simRef.current;
      craftMesh.position.set(craft.position[0], craft.position[1], craft.position[2]);
      const basis = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(craft.right[0], craft.right[1], craft.right[2]),
        new THREE.Vector3(craft.up[0], craft.up[1], craft.up[2]),
        new THREE.Vector3(craft.forward[0], craft.forward[1], craft.forward[2])
      );
      craftMesh.setRotationFromMatrix(basis);
      craftMesh.visible = simRef.current.viewMode !== "first";
      camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
      camera.lookAt(new THREE.Vector3(cam.target[0], cam.target[1], cam.target[2]));
      renderer.render(scene, camera);
      setSpeed(craft.speed);
      setTargetSpeed(craft.targetSpeed);
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      renderer.dispose();
      for (const mesh of chunkMeshes.values()) {
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
      craftMesh.geometry.dispose();
      (craftMesh.material as THREE.Material).dispose();
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} style={{ width: "100vw", height: "100vh", display: "block" }} />
      <ControlsOverlay speed={speed} targetSpeed={targetSpeed} />
    </>
  );
}

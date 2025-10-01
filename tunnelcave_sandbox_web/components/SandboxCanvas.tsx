"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { defaultParams } from "../lib/config";
import { createSimulation, updateSimulation, type SimulationParams } from "../lib/world";
import type { SimulationState } from "../lib/world";
import type { ChunkData } from "../lib/terrain";
import { ControlsOverlay } from "./ControlsOverlay";

interface InputState {
  throttle: number;
  roll: number;
  boost: boolean;
  resetRoll: boolean;
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
  const inputRef = useRef<InputState>({ throttle: 0, roll: 0, boost: false, resetRoll: false });
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
        followDistance: 12,
        heightOffset: 4,
        lateralOffset: 0,
        smoothing: 3
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

    const keyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === "KeyW") inputRef.current.throttle = 1;
      if (event.code === "KeyS") inputRef.current.throttle = -1;
      if (event.code === "KeyA") inputRef.current.roll = -1;
      if (event.code === "KeyD") inputRef.current.roll = 1;
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") inputRef.current.boost = true;
      if (event.code === "Space") inputRef.current.resetRoll = true;
    };

    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "KeyW" && inputRef.current.throttle > 0) inputRef.current.throttle = 0;
      if (event.code === "KeyS" && inputRef.current.throttle < 0) inputRef.current.throttle = 0;
      if (event.code === "KeyA" && inputRef.current.roll < 0) inputRef.current.roll = 0;
      if (event.code === "KeyD" && inputRef.current.roll > 0) inputRef.current.roll = 0;
      if (event.code === "ShiftLeft" || event.code === "ShiftRight") inputRef.current.boost = false;
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
          smoothing: inputRef.current.boost ? 6 : simParams.camera.smoothing
        },
        craftRadius: simParams.craftRadius
      };
      updateSimulation(
        simRef.current,
        params,
        {
          throttleDelta: inputRef.current.throttle,
          rollDelta: inputRef.current.roll
        },
        dt
      );
      if (inputRef.current.resetRoll) {
        simRef.current.craft.roll = 0;
        simRef.current.craft.rollRate = 0;
        inputRef.current.resetRoll = false;
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
      camera.position.set(cam.position[0], cam.position[1], cam.position[2]);
      camera.lookAt(new THREE.Vector3(craft.position[0], craft.position[1], craft.position[2]));
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

'use client'

import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'

import { createVehicleModel } from '../3dmodel/vehicles'
import type { VehicleId } from '../vehicles'

const isWebGLAvailable = () => {
  //1.- Attempt to acquire a WebGL context to determine whether rendering is possible in the host environment.
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
  } catch (error) {
    return false
  }
}

export interface VehiclePreviewCanvasProps {
  vehicleId: VehicleId
}

const setupRenderer = (container: HTMLDivElement) => {
  //1.- Initialise the renderer and append the canvas to the host card.
  const width = container.clientWidth || 320
  const height = container.clientHeight || 220
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(window.devicePixelRatio || 1)
  renderer.setSize(width, height)
  container.appendChild(renderer.domElement)
  return renderer
}

const createCamera = (aspect: number) => {
  //1.- Position a perspective camera so the craft fits comfortably within the viewport.
  const camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 100)
  camera.position.set(4.5, 3.2, 5.4)
  camera.lookAt(new THREE.Vector3(0, 0, 0))
  return camera
}

export default function VehiclePreviewCanvas({ vehicleId }: VehiclePreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    if (!isWebGLAvailable()) {
      //1.- Provide a graceful fallback for test environments without WebGL support.
      container.dataset.webgl = 'unavailable'
      container.textContent = 'Interactive preview unavailable in this environment.'
      return
    }

    const renderer = setupRenderer(container)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x05070a)
    const camera = createCamera(renderer.getSize(new THREE.Vector2()).width / renderer.getSize(new THREE.Vector2()).height)

    const ambient = new THREE.AmbientLight(0xffffff, 0.7)
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8)
    keyLight.position.set(5, 8, 6)
    const backLight = new THREE.DirectionalLight(0xffffff, 0.4)
    backLight.position.set(-4, -6, -5)
    scene.add(ambient)
    scene.add(keyLight)
    scene.add(backLight)

    const model = createVehicleModel(vehicleId)
    scene.add(model)

    let frameId = 0
    const renderLoop = () => {
      model.rotation.y += 0.01
      renderer.render(scene, camera)
      frameId = requestAnimationFrame(renderLoop)
    }
    renderLoop()

    const handleResize = () => {
      const { clientWidth, clientHeight } = container
      renderer.setSize(clientWidth, clientHeight)
      camera.aspect = clientWidth / clientHeight
      camera.updateProjectionMatrix()
    }
    window.addEventListener('resize', handleResize)

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', handleResize)
      scene.remove(model)
      model.traverse((child) => {
        if ('geometry' in child && child.geometry) {
          child.geometry.dispose()
        }
        if ('material' in child) {
          const material = child.material as THREE.Material | THREE.Material[]
          if (Array.isArray(material)) {
            material.forEach((entry) => entry.dispose())
          } else {
            material.dispose()
          }
        }
      })
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  }, [vehicleId])

  return (
    <div
      aria-label={`${vehicleId} vehicle preview`}
      className="vehicle-preview-frame"
      data-testid={`vehicle-preview-${vehicleId}`}
      ref={containerRef}
      role="img"
    />
  )
}

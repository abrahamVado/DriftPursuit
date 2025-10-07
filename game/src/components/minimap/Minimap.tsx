'use client'

import React, { useEffect, useMemo, useState } from 'react'
import type { MinimapSnapshot } from '@/engine/bootstrap'

export type MinimapProps = {
  getSnapshot: () => MinimapSnapshot | null | undefined
  size?: number
  range?: number
}

const DEFAULT_SIZE = 160
const DEFAULT_RANGE = 600

function clamp(value: number, min: number, max: number) {
  //1.- Bound projected coordinates so icons never escape the minimap canvas.
  return Math.max(min, Math.min(max, value))
}

export function Minimap({ getSnapshot, size = DEFAULT_SIZE, range = DEFAULT_RANGE }: MinimapProps) {
  const [snapshot, setSnapshot] = useState<MinimapSnapshot | null>(null)

  useEffect(() => {
    //1.- Drive a requestAnimationFrame loop so the minimap mirrors the most recent vehicle transforms.
    let raf = 0
    const pump = () => {
      const next = getSnapshot?.()
      setSnapshot(next ?? null)
      raf = requestAnimationFrame(pump)
    }
    raf = requestAnimationFrame(pump)
    //2.- Tear down the animation handle when the component unmounts to prevent orphaned callbacks.
    return () => cancelAnimationFrame(raf)
  }, [getSnapshot])

  const projection = useMemo(() => {
    //1.- Pre-compute projected icon coordinates relative to the local pilot for the current frame.
    const dimension = size
    const center = dimension / 2
    const safeRange = range > 0 ? range : 1
    const scale = dimension / (safeRange * 2)

    if (!snapshot) {
      return { local: { left: center, top: center }, remotes: [] as Array<{ id: string; left: number; top: number }> }
    }

    const anchorX = snapshot.local.position.x
    const anchorZ = snapshot.local.position.z

    const project = (x: number, z: number) => {
      const left = clamp(center + (x - anchorX) * scale, 0, dimension)
      const top = clamp(center + (z - anchorZ) * scale, 0, dimension)
      return { left, top }
    }

    const localPoint = project(snapshot.local.position.x, snapshot.local.position.z)
    const remotes = snapshot.remotes.map((remote) => {
      const point = project(remote.position.x, remote.position.z)
      return { id: remote.vehicleId, left: point.left, top: point.top }
    })

    return { local: localPoint, remotes }
  }, [snapshot, size, range])

  return (
    <div
      aria-label="Minimap overlay"
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: 12,
        border: '2px solid rgba(160, 190, 255, 0.45)',
        background: 'rgba(12, 18, 28, 0.7)',
        boxShadow: '0 8px 18px rgba(0, 0, 0, 0.55)',
        overflow: 'hidden',
        pointerEvents: 'none'
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(circle at center, rgba(120,160,220,0.15), rgba(0,0,0,0.6))',
          pointerEvents: 'none'
        }}
      />

      <div
        data-testid="minimap-local"
        aria-label="Minimap local pilot"
        style={{
          position: 'absolute',
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: '#8de1ff',
          boxShadow: '0 0 10px rgba(141, 225, 255, 0.8)',
          left: projection.local.left,
          top: projection.local.top,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none'
        }}
      />

      {projection.remotes.map((remote) => (
        <div
          key={remote.id}
          data-testid={`minimap-remote-${remote.id}`}
          aria-label={`Minimap remote pilot ${remote.id}`}
          style={{
            position: 'absolute',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: '#f2ad5c',
            boxShadow: '0 0 6px rgba(242, 173, 92, 0.8)',
            left: remote.left,
            top: remote.top,
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none'
          }}
        />
      ))}
    </div>
  )
}

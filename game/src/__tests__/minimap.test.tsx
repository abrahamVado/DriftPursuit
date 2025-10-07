import React from 'react'
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { cleanup, render, screen, act } from '@testing-library/react'
import { Minimap } from '@/components/minimap/Minimap'
import type { MinimapSnapshot } from '@/engine/bootstrap'

describe('Minimap', () => {
  beforeEach(() => {
    //1.- Switch to fake timers and stub RAF so deterministic coordinates can be asserted.
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      return window.setTimeout(() => callback(performance.now()), 16) as unknown as number
    })
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      window.clearTimeout(handle as unknown as number)
    })
  })

  afterEach(() => {
    //1.- Restore the timer environment and clean up the DOM between tests.
    vi.useRealTimers()
    vi.unstubAllGlobals()
    cleanup()
  })

  it('projects the local pilot and remote markers in the expected relative positions', () => {
    //1.- Craft a deterministic minimap snapshot where each axis offset is easy to reason about.
    const snapshot: MinimapSnapshot = {
      local: {
        vehicleId: 'local',
        position: { x: 0, y: 10, z: 0 },
        rotation: { pitch: 0, yaw: 0, roll: 0 }
      },
      remotes: [
        {
          vehicleId: 'remote-east',
          position: { x: 50, y: 0, z: 0 },
          rotation: { pitch: 0, yaw: 0, roll: 0 }
        },
        {
          vehicleId: 'remote-north',
          position: { x: 0, y: 0, z: -100 },
          rotation: { pitch: 0, yaw: 0, roll: 0 }
        }
      ]
    }

    const getSnapshot = vi.fn<[], MinimapSnapshot | null>(() => snapshot)

    render(<Minimap getSnapshot={getSnapshot} size={200} range={100} />)

    act(() => {
      //1.- Advance the fake timers so the RAF loop samples the stubbed snapshot.
      vi.advanceTimersByTime(32)
    })

    expect(getSnapshot).toHaveBeenCalled()

    const local = screen.getByTestId('minimap-local') as HTMLDivElement
    expect(parseFloat(local.style.left)).toBeCloseTo(100, 5)
    expect(parseFloat(local.style.top)).toBeCloseTo(100, 5)

    const remoteEast = screen.getByTestId('minimap-remote-remote-east') as HTMLDivElement
    expect(parseFloat(remoteEast.style.left)).toBeCloseTo(150, 5)
    expect(parseFloat(remoteEast.style.top)).toBeCloseTo(100, 5)

    const remoteNorth = screen.getByTestId('minimap-remote-remote-north') as HTMLDivElement
    expect(parseFloat(remoteNorth.style.left)).toBeCloseTo(100, 5)
    expect(parseFloat(remoteNorth.style.top)).toBeCloseTo(0, 5)
  })
})

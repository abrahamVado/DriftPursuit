import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInput } from '../inputMap'

declare global {
  interface Document {
    pointerLockElement?: Element | null
  }
}

const mockRect = (): DOMRect => ({
  bottom: 100,
  height: 100,
  left: 0,
  right: 100,
  top: 0,
  width: 100,
  x: 0,
  y: 0,
} as DOMRect)

beforeEach(() => {
  document.body.innerHTML = ''
  Object.defineProperty(document, 'pointerLockElement', {
    configurable: true,
    enumerable: true,
    value: null,
    writable: true,
  })
})

describe('createInput pointer lock', () => {
  it('accumulates pointer deltas and orientation while locked', () => {
    //1.- Instantiate input handling on a container that supports pointer lock requests.
    const container = document.createElement('div')
    container.getBoundingClientRect = mockRect
    const requestPointerLock = vi.fn(() => {
      document.pointerLockElement = container
      document.dispatchEvent(new Event('pointerlockchange'))
    })
    ;(container as HTMLElement & { requestPointerLock?: () => void }).requestPointerLock = requestPointerLock
    document.body.appendChild(container)

    const input = createInput(container)

    container.dispatchEvent(new MouseEvent('click'))
    container.dispatchEvent(new MouseEvent('mousemove', { movementX: 5, movementY: -3 }))
    container.dispatchEvent(new MouseEvent('mousemove', { movementX: 2, movementY: 1 }))

    expect(requestPointerLock).toHaveBeenCalled()
    expect(input.pointer.locked).toBe(true)
    expect(input.pointer.deltaX).toBe(7)
    expect(input.pointer.deltaY).toBe(-2)
    expect(input.pointer.yaw).toBe(7)
    expect(input.pointer.pitch).toBe(-2)
  })

  it('falls back to NDC sampling when pointer lock is unavailable', () => {
    //1.- Retain legacy behaviour when pointer lock cannot be activated by sampling absolute coordinates.
    const container = document.createElement('div')
    container.getBoundingClientRect = mockRect
    document.body.appendChild(container)

    const input = createInput(container)

    container.dispatchEvent(new MouseEvent('mousemove', { clientX: 75, clientY: 25 }))

    expect(input.pointer.locked).toBe(false)
    expect(input.pointer.deltaX).toBe(0)
    expect(input.pointer.deltaY).toBe(0)
    expect(input.mouse.x).toBeCloseTo(0.5)
    expect(input.mouse.y).toBeCloseTo(0.5)
  })
})

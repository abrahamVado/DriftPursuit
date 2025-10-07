type PointerState = {
  locked: boolean
  deltaX: number
  deltaY: number
  yaw: number
  pitch: number
}

export function createInput(container: HTMLElement) {
  const keys = new Set<string>()
  const mouse = { x: 0, y: 0 }
  const pointer: PointerState = { locked: false, deltaX: 0, deltaY: 0, yaw: 0, pitch: 0 }
  const pressed = (code: string) => keys.has(code)

  const onKeyDown = (e: KeyboardEvent) => keys.add(e.code)
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code)
  const onPointerLockChange = () => {
    pointer.locked = (document as Document & { pointerLockElement?: Element | null }).pointerLockElement === container
    if (!pointer.locked) {
      pointer.deltaX = 0
      pointer.deltaY = 0
    }
  }
  const onMouseMove = (e: MouseEvent) => {
    if (pointer.locked) {
      pointer.deltaX += e.movementX || 0
      pointer.deltaY += e.movementY || 0
      pointer.yaw += e.movementX || 0
      pointer.pitch += e.movementY || 0
      return
    }

    const rect = container.getBoundingClientRect()
    mouse.x = (e.clientX - rect.left) / rect.width * 2 - 1
    mouse.y = -((e.clientY - rect.top) / rect.height * 2 - 1)
  }
  const onClick = () => {
    const request = (container as HTMLElement & { requestPointerLock?: () => void }).requestPointerLock
    if (!request) return
    request.call(container)
  }

  container.tabIndex = 0
  container.addEventListener('click', onClick)
  container.addEventListener('mousemove', onMouseMove)
  document.addEventListener('pointerlockchange', onPointerLockChange)
  addEventListener('keydown', onKeyDown)
  addEventListener('keyup', onKeyUp)

  return {
    pressed,
    mouse,
    pointer,
    dispose() {
      container.removeEventListener('click', onClick)
      container.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      removeEventListener('keydown', onKeyDown)
      removeEventListener('keyup', onKeyUp)
    }
  }
}

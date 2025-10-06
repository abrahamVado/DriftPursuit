export function createInput(container: HTMLElement) {
  const keys = new Set<string>()
  const mouse = { x: 0, y: 0 }
  const pressed = (code: string) => keys.has(code)

  const onKeyDown = (e: KeyboardEvent) => keys.add(e.code)
  const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code)
  const onMouseMove = (e: MouseEvent) => {
    const rect = container.getBoundingClientRect()
    mouse.x = (e.clientX - rect.left) / rect.width * 2 - 1
    mouse.y = -((e.clientY - rect.top) / rect.height * 2 - 1)
  }
  container.tabIndex = 0
  container.addEventListener('mousemove', onMouseMove)
  addEventListener('keydown', onKeyDown)
  addEventListener('keyup', onKeyUp)

  return {
    pressed,
    mouse,
    dispose() {
      container.removeEventListener('mousemove', onMouseMove)
      removeEventListener('keydown', onKeyDown)
      removeEventListener('keyup', onKeyUp)
    }
  }
}

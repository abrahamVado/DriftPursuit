const KEY_ALIASES: Record<string, string> = {
  //1.- Normalise movement key codes to their printed counterparts.
  KeyW: 'W',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  KeyQ: 'Q',
  KeyE: 'E',
  ArrowUp: 'Arrow Up',
  ArrowDown: 'Arrow Down',
  ArrowLeft: 'Arrow Left',
  ArrowRight: 'Arrow Right',
  Space: 'Space',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
}

export const formatKeyLabel = (key: string): string => {
  //1.- Provide a readable fallback by stripping the "Key" prefix when applicable.
  if (KEY_ALIASES[key]) {
    return KEY_ALIASES[key]
  }
  if (key.startsWith('Key') && key.length === 4) {
    return key.slice(3)
  }
  return key
}

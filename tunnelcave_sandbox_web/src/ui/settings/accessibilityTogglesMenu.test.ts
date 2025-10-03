import { describe, expect, it } from 'vitest'
import { AccessibilityOptions } from '../../input/accessibilityOptions'
import { RadarPaletteController } from '../../hud/radarPalettes'
import {
  AccessibilityPreferenceStore,
  ACCESSIBILITY_STORAGE_KEY,
} from './accessibilityPreferenceStore'
import { AccessibilityTogglesMenu } from './accessibilityTogglesMenu'

class MemoryStorage implements Storage {
  //1.- Provide a deterministic storage stub to validate persistence behaviour.
  private store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

describe('AccessibilityTogglesMenu', () => {
  it('loads stored toggle preferences on initial render', () => {
    //1.- Seed a stored toggle payload so the UI honours persisted preferences.
    const storage = new MemoryStorage()
    storage.setItem(
      ACCESSIBILITY_STORAGE_KEY,
      JSON.stringify({ toggles: { radarPalette: 'colorSafe', reducedMotion: true } }),
    )
    const root = document.createElement('div')
    document.body.append(root)
    const options = new AccessibilityOptions()
    const store = new AccessibilityPreferenceStore(storage)
    const controller = new RadarPaletteController(document)
    new AccessibilityTogglesMenu(root, options, store, controller)
    //2.- Validate both the DOM controls and global dataset reflect the stored choices.
    const select = root.querySelector('select') as HTMLSelectElement
    expect(select.value).toBe('colorSafe')
    const checkbox = root.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    expect(document.documentElement.dataset.reducedMotion).toBe('true')
  })

  it('persists toggle changes and applies visual updates', () => {
    //1.- Render with defaults and flip both toggles to ensure persistence occurs.
    const storage = new MemoryStorage()
    const root = document.createElement('div')
    document.body.append(root)
    const options = new AccessibilityOptions()
    const store = new AccessibilityPreferenceStore(storage)
    const controller = new RadarPaletteController(document)
    new AccessibilityTogglesMenu(root, options, store, controller)
    const select = root.querySelector('select') as HTMLSelectElement
    select.value = 'colorSafe'
    select.dispatchEvent(new Event('change'))
    const checkbox = root.querySelector('input[type="checkbox"]') as HTMLInputElement
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change'))
    //2.- The dataset and storage should now reflect the new accessibility choices.
    expect(document.documentElement.dataset.reducedMotion).toBe('true')
    const payload = storage.getItem(ACCESSIBILITY_STORAGE_KEY)
    expect(payload).toBeTruthy()
    const parsed = JSON.parse(payload!)
    expect(parsed.toggles).toEqual({ radarPalette: 'colorSafe', reducedMotion: true })
    expect(parsed.keybindings ?? {}).toEqual({})
    //3.- The accessibility options object should now report the updated state to other systems.
    expect(options.toggleState()).toEqual({ radarPalette: 'colorSafe', reducedMotion: true })
  })
})

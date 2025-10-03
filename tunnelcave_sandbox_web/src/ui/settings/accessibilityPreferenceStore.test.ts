import { describe, expect, it } from 'vitest'
import {
  AccessibilityToggleState,
  DEFAULT_ACCESSIBILITY_TOGGLES,
} from '../../input/accessibilityOptions'
import { AccessibilityPreferenceStore, ACCESSIBILITY_STORAGE_KEY } from './accessibilityPreferenceStore'

class MemoryStorage implements Storage {
  //1.- Provide a deterministic in-memory storage implementation for tests.
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

describe('AccessibilityPreferenceStore', () => {
  it('loads previously persisted payloads', () => {
    //1.- Pre-seed the storage with an override payload to ensure hydration works.
    const storage = new MemoryStorage()
    storage.setItem(
      ACCESSIBILITY_STORAGE_KEY,
      JSON.stringify({ keybindings: { Accelerate: { key: 'ArrowUp' } } }),
    )
    const store = new AccessibilityPreferenceStore(storage)
    expect(store.keybindingOverrides()).toEqual({ Accelerate: { key: 'ArrowUp' } })
    expect(store.toggleState()).toEqual(DEFAULT_ACCESSIBILITY_TOGGLES)
  })

  it('persists keybinding overrides and toggle state updates', () => {
    //1.- Apply both keybinding overrides and toggle updates to validate persistence.
    const storage = new MemoryStorage()
    const store = new AccessibilityPreferenceStore(storage)
    store.saveKeybindings({ Boost: { key: 'KeyF' } })
    const toggles: AccessibilityToggleState = { radarPalette: 'colorSafe', reducedMotion: true }
    store.saveToggles(toggles)
    //2.- Reload the store from the backing storage to confirm round-trip fidelity.
    const reloaded = new AccessibilityPreferenceStore(storage)
    expect(reloaded.keybindingOverrides()).toEqual({ Boost: { key: 'KeyF' } })
    expect(reloaded.toggleState()).toEqual(toggles)
  })
})

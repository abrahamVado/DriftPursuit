import { type AccessibilityToggleState, DEFAULT_ACCESSIBILITY_TOGGLES } from '../../input/accessibilityOptions'
import type { KeybindingOverrides } from '../../input/keybindings'

export interface StoredAccessibilityPreferences {
  //1.- Serialised keybinding overrides keyed by the gameplay action name.
  keybindings?: KeybindingOverrides
  //2.- Persisted toggle values that complement the override information.
  toggles?: AccessibilityToggleState
}

export const ACCESSIBILITY_STORAGE_KEY = 'driftpursuit.accessibility'

export class AccessibilityPreferenceStore {
  private readonly storage: Storage
  private cache: StoredAccessibilityPreferences

  constructor(storage: Storage) {
    //1.- Remember the storage implementation so preferences can be written back immediately.
    this.storage = storage
    //2.- Attempt to hydrate the cache using the previously saved JSON payload.
    this.cache = this.read()
  }

  preferences(): StoredAccessibilityPreferences {
    //1.- Return a structured clone to avoid accidental external mutation of the cache.
    const keybindings = this.cache.keybindings ? { ...this.cache.keybindings } : undefined
    const toggles = this.cache.toggles ? { ...this.cache.toggles } : undefined
    return { keybindings, toggles }
  }

  keybindingOverrides(): KeybindingOverrides {
    //1.- Fallback to an empty object when no keybinding overrides were previously saved.
    return this.cache.keybindings ? { ...this.cache.keybindings } : {}
  }

  toggleState(): AccessibilityToggleState {
    //1.- Merge the cached toggles with the defaults to guarantee a full state shape.
    return { ...DEFAULT_ACCESSIBILITY_TOGGLES, ...this.cache.toggles }
  }

  saveKeybindings(overrides: KeybindingOverrides): void {
    //1.- Update the cache and synchronise it with persistent storage.
    this.cache = { ...this.cache, keybindings: { ...overrides } }
    this.write()
  }

  saveToggles(toggles: AccessibilityToggleState): void {
    //1.- Record the latest toggle state so reloading the menu preserves accessibility choices.
    this.cache = { ...this.cache, toggles: { ...toggles } }
    this.write()
  }

  private read(): StoredAccessibilityPreferences {
    //1.- Attempt to parse stored JSON while handling malformed payloads gracefully.
    try {
      const raw = this.storage.getItem(ACCESSIBILITY_STORAGE_KEY)
      if (!raw) {
        return {}
      }
      const parsed = JSON.parse(raw) as StoredAccessibilityPreferences
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  private write(): void {
    //1.- Persist the cache in a deterministic JSON shape for debugging clarity.
    const payload = JSON.stringify(this.cache)
    this.storage.setItem(ACCESSIBILITY_STORAGE_KEY, payload)
  }
}

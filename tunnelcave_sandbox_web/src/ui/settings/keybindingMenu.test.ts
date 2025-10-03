import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccessibilityOptions } from '../../input/accessibilityOptions'
import { createKeybindingConfiguration } from '../../input/keybindings'
import {
  AccessibilityPreferenceStore,
  ACCESSIBILITY_STORAGE_KEY,
} from './accessibilityPreferenceStore'
import { KeybindingMenu } from './keybindingMenu'

class MemoryStorage implements Storage {
  //1.- Provide a deterministic in-memory storage implementation for repeatable tests.
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

describe('KeybindingMenu', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('renders overrides loaded from storage', () => {
    //1.- Seed storage so the menu initialises with a remapped accelerate action.
    storage.setItem(
      ACCESSIBILITY_STORAGE_KEY,
      JSON.stringify({ keybindings: { Accelerate: { key: 'ArrowUp' } } }),
    )
    const root = document.createElement('div')
    document.body.append(root)
    const options = new AccessibilityOptions(createKeybindingConfiguration())
    const store = new AccessibilityPreferenceStore(storage)
    new KeybindingMenu(root, options, store)
    //2.- Inspect the rendered entries to confirm the override surfaced in the UI.
    const entries = Array.from(root.querySelectorAll('dd button')).map((node) => node.textContent)
    expect(entries).toContain('Arrow Up')
  })

  it('captures keyboard input and saves overrides to storage', () => {
    //1.- Render the menu with the default configuration to capture a new binding.
    const root = document.createElement('div')
    document.body.append(root)
    const options = new AccessibilityOptions(createKeybindingConfiguration())
    const store = new AccessibilityPreferenceStore(storage)
    const menu = new KeybindingMenu(root, options, store, document)
    const accelerateButton = root.querySelector('button[data-action="Accelerate"]') as HTMLButtonElement
    accelerateButton.click()
    //2.- Dispatch a simulated keydown to trigger the rebinding workflow.
    const event = new KeyboardEvent('keydown', { code: 'ArrowUp' })
    document.dispatchEvent(event)
    menu.destroy()
    const payload = storage.getItem(ACCESSIBILITY_STORAGE_KEY)
    expect(payload).toBeTruthy()
    expect(JSON.parse(payload!)).toEqual({ keybindings: { Accelerate: { key: 'ArrowUp' } } })
    //3.- The button text should now reflect the captured key for visual confirmation.
    expect(accelerateButton.textContent).toBe('Arrow Up')
  })
})

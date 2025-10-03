import { AccessibilityOptions } from '../../input/accessibilityOptions'
import { formatKeyLabel } from '../../input/keyLabels'
import {
  Keybinding,
  KeybindingConfiguration,
  KeybindingOverrides,
} from '../../input/keybindings'
import { AccessibilityPreferenceStore } from './accessibilityPreferenceStore'

type KeybindingCaptureHandler = (event: KeyboardEvent) => void

export class KeybindingMenu {
  private readonly container: HTMLElement
  private readonly options: AccessibilityOptions
  private readonly store: AccessibilityPreferenceStore
  private readonly ownerDocument: Document
  private captureAction: string | null = null
  private captureHandler: KeybindingCaptureHandler | null = null

  constructor(
    root: HTMLElement,
    options: AccessibilityOptions,
    store: AccessibilityPreferenceStore,
    ownerDocument: Document = document,
  ) {
    //1.- Persist collaborators so the UI can mutate accessibility state and storage.
    this.options = options
    this.store = store
    this.ownerDocument = ownerDocument
    //2.- Hydrate the keybinding configuration with any previously saved overrides.
    const overrides = this.store.keybindingOverrides()
    if (Object.keys(overrides).length > 0) {
      this.options.apply(overrides)
    }
    //3.- Render the menu container immediately so the call site receives visible controls.
    this.container = ownerDocument.createElement('section')
    this.container.className = 'accessibility-keybindings'
    const heading = ownerDocument.createElement('h3')
    heading.textContent = 'Keybindings'
    this.container.append(heading)
    root.append(this.container)
    this.render()
  }

  destroy(): void {
    //1.- Remove the capture listener to avoid leaking closures when the menu is torn down.
    if (this.captureHandler) {
      this.ownerDocument.removeEventListener('keydown', this.captureHandler, true)
    }
  }

  private render(): void {
    //1.- Rebuild the bindings list so overrides immediately surface to the player.
    const list = this.ownerDocument.createElement('dl')
    list.className = 'accessibility-keybindings__list'
    const bindings = this.options.currentConfiguration().describe()
    for (const binding of bindings) {
      this.appendEntry(list, binding)
    }
    //2.- Swap the previous list to ensure the DOM stays in sync with the latest state.
    const existingList = this.container.querySelector('dl')
    if (existingList) {
      existingList.replaceWith(list)
    } else {
      this.container.append(list)
    }
  }

  private appendEntry(list: HTMLElement, binding: Keybinding): void {
    //1.- Create the definition list entry for the supplied binding.
    const term = this.ownerDocument.createElement('dt')
    term.textContent = binding.action
    const value = this.ownerDocument.createElement('dd')
    const button = this.ownerDocument.createElement('button')
    button.type = 'button'
    button.dataset.action = binding.action
    button.className = 'accessibility-keybindings__control'
    button.textContent = formatKeyLabel(binding.key)
    button.addEventListener('click', () => this.beginCapture(binding.action, button))
    const defaultLabel = this.ownerDocument.createElement('small')
    defaultLabel.className = 'accessibility-keybindings__default'
    defaultLabel.textContent = `Default: ${formatKeyLabel(binding.defaultKey)}`
    value.append(button, defaultLabel)
    list.append(term, value)
  }

  private beginCapture(action: string, button: HTMLButtonElement): void {
    //1.- Prevent multiple capture sessions from running simultaneously.
    this.endCapture()
    this.captureAction = action
    button.dataset.capturing = 'true'
    button.textContent = 'Press a key...'
    this.captureHandler = (event: KeyboardEvent) => this.completeCapture(event, button)
    this.ownerDocument.addEventListener('keydown', this.captureHandler, true)
  }

  private endCapture(): void {
    //1.- Stop listening for keydown events and reset UI affordances.
    if (this.captureHandler) {
      this.ownerDocument.removeEventListener('keydown', this.captureHandler, true)
    }
    this.captureHandler = null
    this.captureAction = null
    const active = this.container.querySelector('button[data-capturing="true"]')
    if (active instanceof HTMLButtonElement) {
      active.dataset.capturing = 'false'
      const binding = this.lookupBinding(active.dataset.action)
      if (binding) {
        active.textContent = formatKeyLabel(binding.key)
      }
    }
  }

  private completeCapture(event: KeyboardEvent, button: HTMLButtonElement): void {
    //1.- Ignore repeated events to reduce accidental duplicate registrations.
    if (event.repeat || !this.captureAction) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const key = event.code
    const action = this.captureAction
    this.options.apply({ [action]: { key } })
    this.persistOverrides()
    button.dataset.capturing = 'false'
    button.textContent = formatKeyLabel(key)
    this.captureAction = null
    this.endCapture()
  }

  private persistOverrides(): void {
    //1.- Collect the current overrides so they can be written back to persistent storage.
    const overrides: KeybindingOverrides = {}
    const config: KeybindingConfiguration = this.options.currentConfiguration()
    for (const binding of config.describe()) {
      if (binding.key !== binding.defaultKey) {
        overrides[binding.action] = { key: binding.key }
      }
    }
    this.store.saveKeybindings(overrides)
    //2.- Re-render the list to refresh default annotations after saving.
    this.render()
  }

  private lookupBinding(action?: string): Keybinding | undefined {
    //1.- Resolve the binding so we can refresh button labels when cancelling capture state.
    if (!action) {
      return undefined
    }
    return this.options.currentConfiguration().describe().find((entry) => entry.action === action)
  }
}

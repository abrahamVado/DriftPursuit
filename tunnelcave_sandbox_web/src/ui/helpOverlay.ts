import { KeybindingConfiguration } from '../input/keybindings'
import { formatKeyLabel } from '../input/keyLabels'

export class HelpOverlay {
  private readonly container: HTMLElement
  private readonly list: HTMLElement

  constructor(root: HTMLElement, keybindings: KeybindingConfiguration) {
    //1.- Create the persistent overlay container that will hold the help content.
    this.container = document.createElement('section')
    this.container.className = 'help-overlay'
    const heading = document.createElement('h2')
    heading.textContent = 'Controls'
    this.list = document.createElement('dl')
    this.list.className = 'help-controls'
    this.container.append(heading, this.list)
    root.append(this.container)
    this.update(keybindings)
  }

  update(keybindings: KeybindingConfiguration): void {
    //1.- Clear existing entries before rendering the latest keybinding layout.
    this.list.replaceChildren()
    const entries = keybindings.describe()
    for (const binding of entries) {
      //2.- Render the action label followed by the currently assigned key.
      const term = document.createElement('dt')
      term.textContent = binding.action
      const description = document.createElement('dd')
      const activeLabel = formatKeyLabel(binding.key)
      const defaultLabel = formatKeyLabel(binding.defaultKey)
      description.textContent = activeLabel === defaultLabel
        ? activeLabel
        : `${activeLabel} (default: ${defaultLabel})`
      this.list.append(term, description)
    }
  }
}

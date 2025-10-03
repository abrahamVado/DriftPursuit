import { describe, expect, it } from 'vitest'
import { createKeybindingConfiguration } from '../input/keybindings'
import { HelpOverlay } from './helpOverlay'

describe('HelpOverlay', () => {
  it('renders the default control scheme', () => {
    //1.- Build the overlay using the stock keybindings.
    const root = document.createElement('div')
    const config = createKeybindingConfiguration()
    new HelpOverlay(root, config)
    //2.- Extract the rendered keys to validate the help listing.
    const items = Array.from(root.querySelectorAll('dd')).map((node) => node.textContent)
    expect(items).toContain('W')
    expect(items).toContain('D')
    expect(items).toContain('Space')
  })

  it('shows both overridden and default keys for remapped actions', () => {
    //1.- Override throttle and steering to alternate keys for accessibility validation.
    const root = document.createElement('div')
    const config = createKeybindingConfiguration({
      Accelerate: { key: 'ArrowUp' },
      'Steer Left': { key: 'ArrowLeft' },
    })
    new HelpOverlay(root, config)
    //2.- Confirm the overlay indicates the customised key while referencing the default.
    const entries = Array.from(root.querySelectorAll('dd')).map((node) => node.textContent)
    expect(entries).toContain('Arrow Up (default: W)')
    expect(entries).toContain('Arrow Left (default: A)')
  })
})

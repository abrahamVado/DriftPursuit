import { describe, expect, it } from 'vitest'
import { RespawnOverlay } from './respawnOverlay'

describe('RespawnOverlay', () => {
  it('renders countdown information', () => {
    //1.- Provide a root element and instantiate the overlay widget.
    const root = document.createElement('div')
    const overlay = new RespawnOverlay(root)
    overlay.update({ remainingMs: 2400, ringLabel: 'Ring 3A' })
    //2.- Locate the generated nodes to verify textual content.
    const timer = root.querySelector('.respawn-timer')
    const location = root.querySelector('.respawn-location')
    expect(timer?.textContent).toBe('2.4 s')
    expect(location?.textContent).toBe('Ring 3A')
  })

  it('hides the overlay once the timer expires', () => {
    //1.- Instantiate and immediately hide by sending a completed status.
    const root = document.createElement('div')
    const overlay = new RespawnOverlay(root)
    overlay.update({ remainingMs: 0, ringLabel: 'Ring 3A' })
    const container = root.querySelector('.respawn-overlay') as HTMLElement
    //2.- Confirm the container is not visible after expiration.
    expect(container.style.display).toBe('none')
  })
})

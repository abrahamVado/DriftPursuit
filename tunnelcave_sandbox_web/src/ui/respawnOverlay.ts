export interface RespawnStatus {
  //1.- Remaining milliseconds before the player can respawn.
  remainingMs: number
  //2.- Human readable ring identifier describing the destination.
  ringLabel: string
}

export class RespawnOverlay {
  private readonly container: HTMLElement
  private readonly timerNode: HTMLElement
  private readonly locationNode: HTMLElement

  constructor(root: HTMLElement) {
    //1.- Create semantic child nodes that are styled externally.
    this.container = document.createElement('div')
    this.container.className = 'respawn-overlay'
    this.timerNode = document.createElement('span')
    this.timerNode.className = 'respawn-timer'
    this.locationNode = document.createElement('span')
    this.locationNode.className = 'respawn-location'
    this.container.append(this.timerNode, this.locationNode)
    root.append(this.container)
    this.hide()
  }

  update(status: RespawnStatus): void {
    if (status.remainingMs <= 0) {
      this.hide()
      return
    }
    //1.- Convert the remaining milliseconds into a one decimal second format.
    const remainingSeconds = status.remainingMs / 1000
    this.timerNode.textContent = `${remainingSeconds.toFixed(1)} s`
    //2.- Update the location label so players know the target ring.
    this.locationNode.textContent = status.ringLabel
    //3.- Reveal the overlay to make the information visible.
    this.container.style.display = ''
  }

  hide(): void {
    //1.- Collapse the overlay when there is no countdown active.
    this.container.style.display = 'none'
  }
}

import type { ScoreboardAggregator, ScoreboardEntry } from './scoreboardAggregator'
import { ensureHudStyles } from './hudStyles'

export interface ScoreboardOverlayOptions {
  //1.- Keyboard key toggling the overlay visibility.
  toggleKey?: string
  //2.- Accessible title used for screen reader captioning.
  title?: string
}

export class ScoreboardOverlay {
  private readonly container: HTMLElement
  private readonly table: HTMLTableElement
  private readonly aggregator: ScoreboardAggregator
  private readonly keyHandler: (event: KeyboardEvent) => void
  private readonly entryListener: (event: Event) => void
  private visible = false
  private metricKeys: string[] = []

  constructor(root: HTMLElement, aggregator: ScoreboardAggregator, options: ScoreboardOverlayOptions = {}) {
    ensureHudStyles(root.ownerDocument ?? document)
    this.aggregator = aggregator
    this.container = root.ownerDocument?.createElement('section') ?? document.createElement('section')
    this.container.className = 'hud-scoreboard'
    this.container.setAttribute('aria-hidden', 'true')
    const title = this.container.ownerDocument.createElement('h2')
    title.className = 'hud-scoreboard__title'
    title.textContent = options.title ?? 'Scoreboard'
    this.table = this.container.ownerDocument.createElement('table')
    this.table.className = 'hud-scoreboard__table'
    this.table.createTHead()
    this.table.createTBody()
    const caption = this.container.ownerDocument.createElement('caption')
    caption.textContent = title.textContent ?? 'Scoreboard'
    caption.style.position = 'absolute'
    caption.style.clip = 'rect(0 0 0 0)'
    caption.style.width = '1px'
    caption.style.height = '1px'
    caption.style.overflow = 'hidden'
    this.table.prepend(caption)
    this.container.append(title, this.table)
    root.append(this.container)
    this.entryListener = (event: Event) => {
      const entries = (event as CustomEvent<ScoreboardEntry[]>).detail
      this.metricKeys = this.aggregator.listMetricKeys()
      this.render(entries)
    }
    this.aggregator.addEventListener('entries', this.entryListener as EventListener)
    const toggleKey = options.toggleKey ?? 'Tab'
    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key !== toggleKey || event.defaultPrevented) {
        return
      }
      if (event.altKey || event.ctrlKey || event.metaKey) {
        return
      }
      event.preventDefault()
      this.setVisible(!this.visible)
    }
    window.addEventListener('keydown', this.keyHandler)
  }

  dispose(): void {
    //1.- Remove listeners so overlays do not accumulate when re-created.
    window.removeEventListener('keydown', this.keyHandler)
    this.aggregator.removeEventListener('entries', this.entryListener as EventListener)
  }

  private render(entries: ScoreboardEntry[]): void {
    //1.- Rebuild the header to reflect new metric columns discovered at runtime.
    const head = this.table.tHead ?? this.table.createTHead()
    head.replaceChildren()
    const headerRow = head.insertRow()
    const nameHeader = this.container.ownerDocument.createElement('th')
    nameHeader.scope = 'col'
    nameHeader.textContent = 'Player'
    headerRow.append(nameHeader)
    for (const key of this.metricKeys) {
      const cell = this.container.ownerDocument.createElement('th')
      cell.scope = 'col'
      cell.textContent = prettifyMetricKey(key)
      headerRow.append(cell)
    }
    const body = this.table.tBodies[0] ?? this.table.createTBody()
    body.replaceChildren()
    for (const entry of entries) {
      const row = body.insertRow()
      const nameCell = row.insertCell()
      nameCell.textContent = entry.displayName
      for (const key of this.metricKeys) {
        const valueCell = row.insertCell()
        const value = entry.metrics[key]
        valueCell.textContent = Number.isFinite(value) ? value.toFixed(Number.isInteger(value) ? 0 : 1) : '—'
      }
    }
  }

  private setVisible(visible: boolean): void {
    //1.- Update ARIA and dataset attributes to mirror the visible state.
    this.visible = visible
    this.container.dataset.visible = visible ? 'true' : 'false'
    this.container.setAttribute('aria-hidden', visible ? 'false' : 'true')
  }
}

function prettifyMetricKey(key: string): string {
  //1.- Expand snake_case metric identifiers into human readable labels.
  return key
    .split('_')
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

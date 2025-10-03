import { ensureHudStyles } from './hudStyles'

export interface HudMetricOptions {
  //1.- label describes the semantic metric for assistive technologies.
  label: string
  //2.- Optional description used for aria-live announcements.
  description?: string
  //3.- Initial value rendered before live updates arrive.
  initialValue?: string
}

export class HudMetric {
  private readonly container: HTMLElement
  private readonly valueNode: HTMLElement

  constructor(root: HTMLElement, options: HudMetricOptions) {
    ensureHudStyles(root.ownerDocument ?? document)
    //1.- Materialise a semantic metric block with label and value spans.
    this.container = root.ownerDocument?.createElement('section') ?? document.createElement('section')
    this.container.className = 'hud-metric'
    this.container.setAttribute('role', 'group')
    this.container.setAttribute('aria-label', options.label)
    if (options.description) {
      this.container.setAttribute('aria-description', options.description)
    }
    const labelNode = this.container.ownerDocument.createElement('span')
    labelNode.className = 'hud-metric__label'
    labelNode.textContent = options.label
    this.valueNode = this.container.ownerDocument.createElement('span')
    this.valueNode.className = 'hud-metric__value'
    this.valueNode.textContent = options.initialValue ?? '--'
    this.container.append(labelNode, this.valueNode)
    root.append(this.container)
  }

  update(value: string): void {
    //1.- Update the live region text to surface the latest metric value.
    this.valueNode.textContent = value
  }

  element(): HTMLElement {
    //1.- Expose the container for layout orchestration by higher level controllers.
    return this.container
  }
}

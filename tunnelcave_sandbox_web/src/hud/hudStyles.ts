const STYLE_ELEMENT_ID = 'hud-style-sheet'

//1.- ensureHudStyles injects responsive, high-contrast styles exactly once per document.
export function ensureHudStyles(target: Document | ShadowRoot = document): void {
  if (!('querySelector' in target)) {
    return
  }
  const ownerDocument = 'ownerDocument' in target && target.ownerDocument ? target.ownerDocument : document
  const existing = ownerDocument.getElementById(STYLE_ELEMENT_ID)
  if (existing) {
    return
  }
  const style = ownerDocument.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.textContent = `
    :root {
      color-scheme: light dark;
    }

    .hud-metric {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.25rem 0.5rem;
      align-items: baseline;
      background: rgba(12, 17, 28, 0.78);
      color: #f5f7ff;
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      font-family: 'Segoe UI', system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      box-shadow: 0 0.5rem 1.5rem rgba(0, 0, 0, 0.3);
      min-width: 14rem;
      margin: 0.25rem 0;
    }

    .hud-metric__label {
      text-transform: uppercase;
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      color: #9ad0ff;
    }

    .hud-metric__value {
      font-size: 1.5rem;
      font-weight: 600;
      justify-self: end;
      color: #ffffff;
    }

    .hud-scoreboard {
      position: fixed;
      inset: 5vh 5vw auto 5vw;
      background: rgba(5, 8, 12, 0.9);
      border: 2px solid rgba(154, 208, 255, 0.6);
      border-radius: 0.75rem;
      color: #f3f6ff;
      padding: 1rem;
      z-index: 1000;
      display: none;
      max-height: 90vh;
      overflow: auto;
    }

    .hud-scoreboard[data-visible='true'] {
      display: block;
    }

    .hud-scoreboard__title {
      margin: 0 0 0.75rem 0;
      font-size: 1.25rem;
      font-weight: 600;
      color: #9ad0ff;
    }

    .hud-scoreboard__table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.95rem;
    }

    .hud-scoreboard__table th,
    .hud-scoreboard__table td {
      border-bottom: 1px solid rgba(154, 208, 255, 0.2);
      padding: 0.5rem 0.75rem;
      text-align: left;
    }

    .hud-scoreboard__table th {
      background: rgba(27, 39, 58, 0.8);
      position: sticky;
      top: 0;
      z-index: 1;
      color: #ffffff;
    }

    .hud-scoreboard__table tbody tr:nth-child(even) {
      background: rgba(13, 20, 31, 0.6);
    }

    @media (max-width: 900px) {
      .hud-scoreboard {
        inset: 2vh 2vw auto 2vw;
        padding: 0.75rem;
      }

      .hud-scoreboard__table th,
      .hud-scoreboard__table td {
        padding: 0.4rem 0.5rem;
        font-size: 0.85rem;
      }
    }

    @media (max-width: 600px) {
      .hud-metric {
        grid-template-columns: 1fr;
        text-align: center;
        min-width: 10rem;
      }

      .hud-metric__value {
        justify-self: center;
      }

      .hud-scoreboard__table {
        font-size: 0.8rem;
      }
    }
  `
  ownerDocument.head.append(style)
}

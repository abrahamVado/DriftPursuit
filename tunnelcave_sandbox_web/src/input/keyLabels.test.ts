import { describe, expect, it } from 'vitest'
import { formatKeyLabel } from './keyLabels'

describe('formatKeyLabel', () => {
  it('returns friendly labels for known codes', () => {
    //1.- Check explicit aliases to guarantee stability across overlays.
    expect(formatKeyLabel('KeyW')).toBe('W')
    expect(formatKeyLabel('ArrowLeft')).toBe('Arrow Left')
    expect(formatKeyLabel('ShiftLeft')).toBe('Left Shift')
  })

  it('derives labels for letter keys without explicit aliases', () => {
    //1.- Confirm the helper strips the "Key" prefix for alphabetic codes.
    expect(formatKeyLabel('KeyR')).toBe('R')
  })

  it('falls back to the original code for unknown keys', () => {
    //1.- Provide an unknown identifier so the fallback path is exercised.
    expect(formatKeyLabel('BracketLeft')).toBe('BracketLeft')
  })
})

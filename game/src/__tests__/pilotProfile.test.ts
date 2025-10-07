import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_PILOT_NAME,
  DEFAULT_VEHICLE_KEY,
  VEHICLE_KEYS,
  createPilotProfile,
  normalizePilotName,
  normalizeVehicleChoice
} from '@/lib/pilotProfile'

//1.- Confirm trimming removes excess whitespace while preserving readable characters.
describe('normalizePilotName', () => {
  it('collapses whitespace and strips control characters', () => {
    const raw = '  Ace\u0007 Pilot  '
    expect(normalizePilotName(raw)).toBe('Ace Pilot')
  })

  it('returns an empty string for invalid input', () => {
    expect(normalizePilotName('   ')).toBe('')
    expect(normalizePilotName(undefined)).toBe('')
  })
})

//1.- Guarantee unknown vehicle keys fall back to the default chassis.
describe('normalizeVehicleChoice', () => {
  it('passes through known vehicles', () => {
    for (const key of VEHICLE_KEYS) {
      expect(normalizeVehicleChoice(key)).toBe(key)
    }
  })

  it('defaults to arrowhead when the choice is unsupported', () => {
    expect(normalizeVehicleChoice('unknown')).toBe(DEFAULT_VEHICLE_KEY)
  })
})

//1.- Validate the aggregated profile object exposes fallback metadata for UI flows.
describe('createPilotProfile', () => {
  it('applies defaults when inputs are missing', () => {
    const uuidSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('11111111-2222-3333-4444-555555555555')
    const profile = createPilotProfile({ name: '', vehicle: '' })
    uuidSpy.mockRestore()
    expect(profile.name).toBe(DEFAULT_PILOT_NAME)
    expect(profile.vehicle).toBe(DEFAULT_VEHICLE_KEY)
    expect(profile.usedFallbackName).toBe(true)
    expect(profile.usedFallbackVehicle).toBe(true)
    expect(profile.clientId).toBe('pilot-rookie-pilot-11111111')
  })

  it('retains valid selections and produces a deterministic client id', () => {
    const profile = createPilotProfile({ name: 'Nova Prime', vehicle: 'cube' })
    expect(profile.name).toBe('Nova Prime')
    expect(profile.vehicle).toBe('cube')
    expect(profile.usedFallbackName).toBe(false)
    expect(profile.usedFallbackVehicle).toBe(false)
    expect(profile.clientId).toBe('pilot-nova-prime')
  })

  it('generates distinct client ids when defaults apply multiple times', () => {
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID')
    uuidSpy
      .mockReturnValueOnce('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
      .mockReturnValueOnce('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
    const first = createPilotProfile({ name: '', vehicle: '' })
    const second = createPilotProfile({ name: '', vehicle: '' })
    uuidSpy.mockRestore()
    expect(first.clientId).toBe('pilot-rookie-pilot-aaaaaaaa')
    expect(second.clientId).toBe('pilot-rookie-pilot-bbbbbbbb')
    expect(first.clientId).not.toBe(second.clientId)
  })
})

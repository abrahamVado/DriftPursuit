import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { usePersistentSetting } from './usePersistentSetting'

describe('usePersistentSetting', () => {
  beforeEach(() => {
    //1.- Reset storage between runs so assertions remain deterministic.
    window.localStorage.clear()
  })

  it('returns the default value when storage is empty', () => {
    const { result } = renderHook(() => usePersistentSetting('test-key', 42))
    expect(result.current[0]).toBe(42)
  })

  it('stores updates in localStorage and updates state', () => {
    const { result } = renderHook(() => usePersistentSetting('test-key', 0))

    act(() => {
      result.current[1](7)
    })

    expect(result.current[0]).toBe(7)
    expect(window.localStorage.getItem('test-key')).toBe('7')
  })

  it('responds to storage events', () => {
    const { result } = renderHook(() => usePersistentSetting('test-key', 1))

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'test-key', newValue: JSON.stringify(9) }),
      )
    })

    expect(result.current[0]).toBe(9)
  })
})

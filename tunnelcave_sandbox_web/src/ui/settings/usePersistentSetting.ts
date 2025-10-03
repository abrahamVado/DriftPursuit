'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

export type PersistentSetter<T> = (value: T | ((previous: T) => T)) => void

export function usePersistentSetting<T>(key: string, defaultValue: T): [T, PersistentSetter<T>] {
  //1.- Detect whether the hook executes in a browser environment before using localStorage APIs.
  const isClient = typeof window !== 'undefined'
  //2.- Memoize the storage reader to avoid re-parsing JSON on every render when the value is stable.
  const readValue = useMemo(() => {
    return (): T => {
      if (!isClient) {
        return defaultValue
      }
      try {
        const raw = window.localStorage.getItem(key)
        if (!raw) {
          return defaultValue
        }
        return JSON.parse(raw) as T
      } catch {
        return defaultValue
      }
    }
  }, [defaultValue, isClient, key])

  const [value, setValue] = useState<T>(() => readValue())

  useEffect(() => {
    //1.- When running client side, mirror state changes into localStorage for persistence.
    if (!isClient) {
      return
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      //1.- Swallow storage exceptions (e.g., quota errors) so UI remains usable.
    }
  }, [isClient, key, value])

  useEffect(() => {
    //1.- Subscribe to storage events so updates from other tabs stay in sync.
    if (!isClient) {
      return
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== key) {
        return
      }
      if (event.storageArea && event.storageArea !== window.localStorage) {
        return
      }
      setValue(event.newValue ? (JSON.parse(event.newValue) as T) : defaultValue)
    }
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
    }
  }, [defaultValue, isClient, key])

  const update: PersistentSetter<T> = useCallback(
    (next) => {
      //1.- Support both direct values and updater functions for ergonomic callers.
      setValue((current) => (typeof next === 'function' ? (next as (previous: T) => T)(current) : next))
    },
    [],
  )

  return [value, update]
}

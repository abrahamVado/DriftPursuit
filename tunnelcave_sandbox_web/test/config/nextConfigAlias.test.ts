import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('next.config.mjs webpack alias', () => {
  afterEach(() => {
    //1.- Restore spies so each test evaluates the resolver with fresh filesystem semantics.
    vi.restoreAllMocks()
    //2.- Reset the module cache so subsequent imports execute the resolver logic again.
    vi.resetModules()
  })

  it('merges the @client alias with existing entries', async () => {
    //1.- Load the Next.js config to access the webpack hook for alias inspection.
    const { default: nextConfig, resolveClientSourcePath } = await import('../../next.config.mjs')
    const webpack = nextConfig.webpack

    if (!webpack) {
      throw new Error('Expected webpack configuration hook to be defined')
    }

    const result = webpack({
      resolve: {
        alias: {
          existing: 'value',
        },
      },
    })

    expect(result.resolve?.alias?.existing).toBe('value')
    expect(result.resolve?.alias?.['@client']).toBe(resolveClientSourcePath())
  })

  it('falls back to the local copy when the sibling directory is absent', async () => {
    //1.- Force the resolver to pretend the sibling directory is missing so the local copy can be selected.
    vi.resetModules()

    const siblingPath = path.resolve(process.cwd(), '../typescript-client/src')
    const localPath = path.resolve(process.cwd(), 'typescript-client/src')
    const realExistsSync = fs.existsSync
    const spy = vi.spyOn(fs, 'existsSync').mockImplementation((candidate) => {
      if (candidate === siblingPath) {
        return false
      }
      if (candidate === localPath) {
        return true
      }
      return realExistsSync(candidate as fs.PathLike)
    })

    const { resolveClientSourcePath } = await import('../../next.config.mjs')

    expect(spy).toHaveBeenCalled()
    expect(resolveClientSourcePath()).toBe(localPath)
  })
})

import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('next.config.mjs webpack alias', () => {
  it('merges the @client alias with existing entries', async () => {
    //1.- Load the Next.js config to access the webpack hook for alias inspection.
    const { default: nextConfig } = await import('../../next.config.mjs')
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
    expect(result.resolve?.alias?.['@client']).toBe(
      path.resolve(process.cwd(), '../typescript-client/src'),
    )
  })
})

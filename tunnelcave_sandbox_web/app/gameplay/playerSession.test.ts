import { describe, expect, it } from 'vitest'

import { createPlayerSessionId } from './playerSession'

describe('createPlayerSessionId', () => {
  it('prefixes identifiers with pilot', () => {
    const id = createPlayerSessionId(() => 0.123456, () => 123456)
    expect(id.startsWith('pilot-')).toBe(true)
  })

  it('yields unique identifiers for sequential calls', () => {
    let tick = 1000
    const values = [0.1, 0.2, 0.3, 0.4]
    let index = 0
    const random = () => values[index++ % values.length]
    const timestamp = () => tick++
    const ids = new Set<string>()
    for (let attempt = 0; attempt < 4; attempt += 1) {
      ids.add(createPlayerSessionId(random, timestamp))
    }
    expect(ids.size).toBe(4)
  })
})


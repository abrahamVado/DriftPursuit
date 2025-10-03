import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(appDir, '..', '..')
const envFile = join(repoRoot, 'tunnelcave_sandbox_web', '.env.local')
const scriptPath = join(repoRoot, 'scripts', 'setup-env.sh')

async function runScript() {
  //1.- Execute the Bash helper so the test observes the freshly scaffolded file contents.
  await new Promise<void>((resolvePromise, rejectPromise) => {
    execFile('bash', [scriptPath], { cwd: repoRoot }, (error) => {
      if (error) {
        rejectPromise(error)
        return
      }
      resolvePromise()
    })
  })
}

describe('setup-env.sh', () => {
  let originalContent: string | null = null
  let existedBefore = false

  beforeEach(async () => {
    //1.- Capture the existing .env.local (if any) so the test can restore it afterwards.
    try {
      originalContent = await fs.readFile(envFile, 'utf8')
      existedBefore = true
    } catch {
      originalContent = null
      existedBefore = false
    }
    //2.- Remove the file to simulate a first-time onboarding experience.
    await fs.rm(envFile, { force: true })
  })

  afterEach(async () => {
    //1.- Restore or clean up the .env.local file so other tests are unaffected.
    if (existedBefore && originalContent !== null) {
      await fs.writeFile(envFile, originalContent, 'utf8')
    } else {
      await fs.rm(envFile, { force: true })
    }
  })

  it('creates a .env.local with documented defaults', async () => {
    await runScript()
    const scaffolded = await fs.readFile(envFile, 'utf8')
    //1.- Verify the onboarding comments and sample values are written to disk.
    expect(scaffolded).toContain('Drift Pursuit sandbox environment configuration.')
    expect(scaffolded).toContain('NEXT_PUBLIC_BROKER_URL=ws://localhost:43127/ws')
    expect(scaffolded).toContain('NEXT_PUBLIC_SIM_BRIDGE_URL=http://localhost:8000')
  })
})

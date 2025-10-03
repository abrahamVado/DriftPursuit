import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { expect, test } from '@playwright/test'

async function ensureArtifactPath(filePath: string): Promise<void> {
  //1.- Guarantee the screenshot directory exists before Playwright writes the artifact.
  await mkdir(dirname(filePath), { recursive: true })
}

test('captures a default visual snapshot of the client shell', async ({ page }) => {
  const baseUrl = process.env.VISUALIZER_BASE_URL ?? 'http://localhost:3000'
  const screenshotPath = process.env.VISUALIZER_SMOKE_OUTPUT ?? 'artifacts/visualizer-smoke.png'

  //1.- Prepare the filesystem target so the screenshot call cannot fail because of a missing folder.
  await ensureArtifactPath(screenshotPath)

  //2.- Navigate to the running Next.js client and wait for the application shell to become visible.
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await expect(page.locator('#__next')).toBeVisible()

  //3.- Stabilize the UI by ensuring either the HUD root test id or the primary canvas is visible.
  const hudOrCanvas = page.locator('[data-testid="hud-root"], canvas').first()
  await expect(hudOrCanvas).toBeVisible({ timeout: 5000 })

  //4.- Capture a full-page screenshot for downstream visual regression diffing.
  await page.screenshot({ path: screenshotPath, fullPage: true })
})

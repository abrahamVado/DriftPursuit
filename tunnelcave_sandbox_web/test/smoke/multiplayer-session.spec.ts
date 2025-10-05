import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const SANDBOX_BASE_URL = process.env.SANDBOX_BASE_URL ?? 'http://localhost:3000'

const PILOT_SETUPS = [
  { name: 'Pilot Alpha', vehicle: 'arrowhead' },
  { name: 'Pilot Bravo', vehicle: 'aurora' },
  { name: 'Pilot Charlie', vehicle: 'duskfall' },
  { name: 'Pilot Delta', vehicle: 'steelwing' },
  { name: 'Pilot Echo', vehicle: 'arrowhead' },
] as const

test('five pilots converge into the same world session', async ({ browser }) => {
  const contexts: BrowserContext[] = []
  const pages: Page[] = []

  try {
    //1.- Launch a dedicated browser context per pilot to emulate independent player tabs.
    for (const setup of PILOT_SETUPS) {
      const context = await browser.newContext()
      contexts.push(context)
      const page = await context.newPage()
      pages.push(page)

      //2.- Navigate each pilot to the lobby surface and wait for the join controls to appear.
      await page.goto(SANDBOX_BASE_URL, { waitUntil: 'networkidle' })
      const nameInput = page.getByTestId('pilot-name-input')
      const vehicleSelect = page.getByTestId('vehicle-select')
      await expect(nameInput).toBeVisible()
      await expect(vehicleSelect).toBeVisible()

      //3.- Configure the pilot handle and vehicle preset before starting the shared world session.
      await nameInput.fill(setup.name)
      await vehicleSelect.selectOption(setup.vehicle)
      await page.getByTestId('start-session-button').click()

      //4.- Wait for the HUD mount to become active as confirmation that the client shell initialised.
      await expect(page.locator('#hud-root')).toBeVisible({ timeout: 60000 })
      await expect(page.locator('.hud-scoreboard')).toBeVisible({ timeout: 60000 })
    }

    const expectedNames = PILOT_SETUPS.map((setup) => setup.name)

    for (const page of pages) {
      //5.- Toggle the in-game scoreboard so pilot roster entries become visible to the observer.
      await page.keyboard.press('Tab')
      const scoreboard = page.locator('.hud-scoreboard')
      await expect(scoreboard).toHaveAttribute('data-visible', 'true', { timeout: 5000 })

      //6.- Poll the scoreboard rows until every expected pilot name appears in the shared world roster.
      await expect
        .poll(async () => {
          const names = await page.$$eval('.hud-scoreboard__table tbody tr', (rows) =>
            rows
              .map((row) => row.querySelector('td')?.textContent?.trim() ?? '')
              .filter((value) => value.length > 0),
          )
          return expectedNames.every((name) => names.includes(name))
        }, { timeout: 60000 })
        .toBe(true)
    }
  } finally {
    //7.- Ensure every temporary browser context is disposed even if the assertion flow aborts early.
    await Promise.all(contexts.map((context) => context.close()))
  }
})

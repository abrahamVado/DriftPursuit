import { testBossPhasesStateMachine } from './specs/bossPhases.test'
import { testDifficultyScalingAdjustments } from './specs/difficultyScaling.test'
import { testEnvironmentAdjustments } from './specs/environmentAdjustments.test'
import { testPlayerVehicleCreation } from './specs/playerCreation.test'

async function main(): Promise<void> {
  //1.- Execute the deterministic boss phase assertions.
  testBossPhasesStateMachine()
  //2.- Validate difficulty scaling math remains monotonic as new clears accrue.
  testDifficultyScalingAdjustments()
  //3.- Await the asynchronous environment inspection so decorators refresh before checking counts.
  await testEnvironmentAdjustments()
  //4.- Validate the vehicle builder registry for the player stays in sync with the available blueprints.
  testPlayerVehicleCreation()
  //5.- All checks passed if execution reaches this point, so emit a concise summary for CI logs.
  console.log('All tests passed')
}

main().catch((error) => {
  //1.- Surface the failure and exit non-zero to ensure CI is aware.
  console.error('Test failure:', error)
  process.exitCode = 1
})

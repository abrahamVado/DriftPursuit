import { testBossPhasesStateMachine } from './specs/bossPhases.test'
import { testBossDifficultyListenerCleanup } from './specs/bossDifficultyCleanup.test'
import { testDifficultyScalingAdjustments } from './specs/difficultyScaling.test'
import { testEnvironmentAdjustments } from './specs/environmentAdjustments.test'
import { testPlayerVehicleCreation } from './specs/playerCreation.test'
import { testWorldStatusBootstrap } from './specs/worldStatusBootstrap.test'
import { testStreamerDeltaDefault } from './specs/streamerDeltaDefault.test'

async function main(): Promise<void> {
  //1.- Execute the deterministic boss phase assertions.
  testBossPhasesStateMachine()
  //2.- Validate boss difficulty listeners detach after death to avoid stale updates.
  testBossDifficultyListenerCleanup()
  //3.- Validate difficulty scaling math remains monotonic as new clears accrue.
  testDifficultyScalingAdjustments()
  //4.- Await the asynchronous environment inspection so decorators refresh before checking counts.
  await testEnvironmentAdjustments()
  //5.- Confirm the broker world status handshake seeds deterministic terrain streaming across clients.
  await testWorldStatusBootstrap()
  //6.- Confirm streamer updates succeed even when callers omit the optional delta time parameter.
  await testStreamerDeltaDefault()
  //7.- Validate the vehicle builder registry for the player stays in sync with the available blueprints.
  testPlayerVehicleCreation()
  //8.- All checks passed if execution reaches this point, so emit a concise summary for CI logs.
  console.log('All tests passed')
}

main().catch((error) => {
  //1.- Surface the failure and exit non-zero to ensure CI is aware.
  console.error('Test failure:', error)
  process.exitCode = 1
})

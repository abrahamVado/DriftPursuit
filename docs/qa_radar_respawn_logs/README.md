# Radar Occlusion and Respawn QA Evidence

## Radar Occlusion Simulation
- Command: `npm test` (typescript-client)
- Key logs:
  - `QA_LOG_VISIBLE: state=visible occluded=false confidence=0.90 alpha=1.00 timeline=0.0s position=(250.0, 5.0, 0.0)`
  - `QA_LOG_OCCLUDED: state=occluded occluded=true confidence=0.95 alpha=0.76 timeline=0.8s position=(250.0, 5.0, 0.0)`
  - `QA_LOG_DASHED: state=occluded occluded=true confidence=0.95 alpha=0.43 timeline=2.1s position=(250.0, 5.0, 0.0)`
  - `QA_LOG_REACQUIRED: state=visible occluded=false confidence=1.00 alpha=1.00 timeline=0.0s position=(200.0, 5.0, 0.0)`

## Respawn Lifecycle Test
- Command: `go test ./internal/match -run TestRespawnLifecycleSelectsSafeRingAndShield -v`
- Key log:
  - `QA_LOG_RESPAWN ring=forward shield=1.5s`

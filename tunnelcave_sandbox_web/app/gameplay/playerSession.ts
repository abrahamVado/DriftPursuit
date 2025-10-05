export function createPlayerSessionId(
  random: () => number = Math.random,
  timestamp: () => number = () => Date.now(),
): string {
  //1.- Capture the current time so sessions spawned close together still resolve unique handles.
  const timeComponent = timestamp().toString(36)
  //2.- Use two random slices to reduce the probability of collision when multiple tabs open simultaneously.
  const randomComponent = `${Math.floor(random() * 1e8).toString(36)}${Math.floor(random() * 1e8).toString(36)}`
  //3.- Compose the stable session identifier that tags the player in broker negotiations and telemetry.
  return `pilot-${timeComponent}-${randomComponent}`
}


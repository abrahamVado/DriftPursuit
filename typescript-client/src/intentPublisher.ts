//1.- Define helper utilities to clamp numeric control ranges.
const clamp = (value: number, min: number, max: number): number => {
  if (Number.isNaN(value)) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
};

const clampGear = (gear: number): number => {
  if (!Number.isFinite(gear)) {
    return 0;
  }
  return Math.round(clamp(gear, -1, 9));
};

export interface IntentControls {
  //2.- Expose the analog and boolean controls captured in each intent frame.
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  gear: number;
  boost: boolean;
}

export interface IntentFramePayload {
  //3.- Describe the serialized JSON structure sent across the websocket.
  type: "intent";
  id: string;
  schema_version: string;
  controller_id: string;
  sequence_id: number;
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  gear: number;
  boost: boolean;
}

export type IntentSender = (payload: string) => void;

export class IntentPublisher {
  private sequence = 0;

  constructor(
    private readonly controllerId: string,
    private readonly send: IntentSender,
    private readonly schemaVersion = "0.1.0",
  ) {}

  //4.- Prepare the JSON payload, increment the sequence, and emit it via the provided transport.
  publish(controls: IntentControls): IntentFramePayload {
    this.sequence += 1;

    const payload: IntentFramePayload = {
      type: "intent",
      id: this.controllerId,
      schema_version: this.schemaVersion,
      controller_id: this.controllerId,
      sequence_id: this.sequence,
      throttle: clamp(controls.throttle, -1, 1),
      brake: clamp(controls.brake, 0, 1),
      steer: clamp(controls.steer, -1, 1),
      handbrake: controls.handbrake,
      gear: clampGear(controls.gear),
      boost: Boolean(controls.boost),
    };

    this.send(JSON.stringify(payload));
    return payload;
  }

  //5.- Expose the current sequence for diagnostics and test assertions.
  currentSequence(): number {
    return this.sequence;
  }
}

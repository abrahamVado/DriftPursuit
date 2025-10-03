import { describe, expect, it } from "vitest";

import { CONTROL_PANEL_EVENT, type ControlPanelIntentDetail } from "./controlPanelEvents";

describe("controlPanelEvents", () => {
  it("exposes a shared DOM contract for control intents", () => {
    const detail: ControlPanelIntentDetail = { control: "throttle", value: 2, issuedAtMs: 99 };
    const event = new CustomEvent<ControlPanelIntentDetail>(CONTROL_PANEL_EVENT, { detail });
    //1.- Assert the exported identifier is reused as the event type string.
    expect(event.type).toBe(CONTROL_PANEL_EVENT);
    //2.- Confirm type inference preserves payload fields for downstream listeners.
    expect(event.detail).toEqual(detail);
  });
});

export const CONTROL_PANEL_EVENT = "simulation-control-intent";
//1.- Shared DOM event name so HUD and UI components can coordinate control intents.

export type ControlPanelIntent = "throttle" | "brake" | "steer";
//1.- Enumerate the supported control names to keep event payloads strongly typed.

export interface ControlPanelIntentDetail {
  control: ControlPanelIntent;
  value: number;
  issuedAtMs?: number;
}
//1.- Describe the payload fields forwarded with each control intent event.

export type ControlPanelEvent = CustomEvent<ControlPanelIntentDetail>;
//1.- Alias the strongly typed CustomEvent so listeners can narrow event.detail easily.

export function createHudPresets(){
  return {
    system: {
      title: 'Orbital Control',
      throttleLabel: 'ZOOM',
      metricLabels: {
        speed: 'Velocity',
        crashes: 'Participants',
        time: 'Session',
        distance: 'Altitude',
      },
      items: [
        { label: 'Orbit', detail: 'Hold Mouse — pan around focus' },
        { label: 'Zoom', detail: 'Scroll — adjust altitude' },
        { label: 'Select', detail: 'HUD picker — choose planet' },
      ],
    },
    approach: {
      title: 'Atmospheric Entry',
      throttleLabel: 'THR',
      metricLabels: {
        speed: 'Airspeed',
        crashes: 'Incidents',
        time: 'Flight Time',
        distance: 'Altitude',
      },
      items: [
        { label: 'Cycle', detail: '[ / ] — change pilot' },
        { label: 'Focus', detail: 'F — snap to target' },
        { label: 'Fire', detail: 'Click / Space — fire turret' },
      ],
    },
    surface: {
      title: 'Surface Operations',
      throttleLabel: 'PWR',
      metricLabels: {
        speed: 'Speed',
        crashes: 'Incidents',
        time: 'Uptime',
        distance: 'Distance',
      },
      items: [
        { label: 'Cycle', detail: '[ / ] — change pilot' },
        { label: 'Focus', detail: 'F — snap to target' },
        { label: 'Mode', detail: '1 / 2 — toggle air / ground' },
      ],
    },
    departing: {
      title: 'Departure Burn',
      throttleLabel: 'THR',
      metricLabels: {
        speed: 'Velocity',
        crashes: 'Incidents',
        time: 'Uptime',
        distance: 'Altitude',
      },
      items: [
        { label: 'Cycle', detail: '[ / ] — change pilot' },
        { label: 'Focus', detail: 'F — snap to target' },
        { label: 'Fire', detail: 'Click / Space — fire turret' },
      ],
    },
  };
}

export function createHud({
  TerraHUDClass,
  ammoOptions = [],
  mapOptions = [],
  onAmmoSelect,
  onMapSelect,
  presets = createHudPresets(),
} = {}){
  const hud = new TerraHUDClass({
    controls: presets.system,
    ammoOptions,
    mapOptions,
    onAmmoSelect,
    onMapSelect,
  });
  return { hud, presets };
}

export default { createHudPresets, createHud };

export function createHudPresets(){
  return {
    plane: {
      title: 'Spectator (Flight)',
      throttleLabel: 'THR',
      metricLabels: {
        speed: 'Airspeed',
        altitude: 'Altitude',
        latitude: 'Latitude',
        crashes: 'Incidents',
        time: 'Uptime',
        distance: 'Distance Traveled',
      },
      items: [
        { label: 'Cycle', detail: '[ / ] — change player' },
        { label: 'Focus', detail: 'F — snap to focus' },
        { label: 'Fire', detail: 'Click / Space — fire turret' },
      ],
    },
    car: {
      title: 'Spectator (Ground)',
      throttleLabel: 'PWR',
      metricLabels: {
        speed: 'Speed',
        altitude: 'Altitude',
        latitude: 'Latitude',
        crashes: 'Incidents',
        time: 'Uptime',
        distance: 'Distance Traveled',
      },
      items: [
        { label: 'Cycle', detail: '[ / ] — change player' },
        { label: 'Focus', detail: 'F — snap to focus' },
        { label: 'Fire', detail: 'Click / Space — fire turret' },
      ],
    },
  };
}

export function createMapSelectionHandler(onNavigate){
  return (mapId) => {
    if (!mapId) return;
    if (typeof onNavigate === 'function'){
      onNavigate(mapId);
      return;
    }
    if (typeof window !== 'undefined' && window.location){
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('map', mapId);
        window.location.href = url.toString();
      } catch (error){
        window.location.search = `?map=${encodeURIComponent(mapId)}`;
      }
    }
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
    controls: presets.plane,
    ammoOptions,
    mapOptions,
    onAmmoSelect,
    onMapSelect,
  });
  return { hud, presets };
}

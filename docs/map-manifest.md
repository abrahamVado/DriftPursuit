# Custom map manifest

The viewer now supports swapping between the built-in procedural airstrip and authored layouts at runtime.

## Manifest

Map entries live under `viewer/assets/maps`. The `manifest.json` file declares which layouts are available:

```json
{
  "default": "procedural:endless",
  "maps": [
    {
      "id": "procedural:endless",
      "label": "Procedural Airstrip",
      "type": "procedural",
      "seed": "driftpursuit:endless"
    },
    {
      "id": "creator_demo",
      "label": "Creator Demo Layout",
      "type": "tilemap",
      "path": "creator_demo/map.json"
    }
  ]
}
```

* `id` – unique key that appears in the map dropdown.
* `label` – user facing name.
* `type` – currently `procedural` or `tilemap`.
* `seed` / `chunkSize` / `visibleRadius` – optional overrides for procedural maps.
* `procedural` (alias `generator`) – optional object that customizes the procedural world streamer (noise curves, feature toggles, color palette, etc.).
* `path` – relative path to the tilemap descriptor.

The `default` value controls which option is selected when the viewer boots.

## Tile map descriptor

Tilemap descriptors describe authored tiles on a square grid. The demo layout in `viewer/assets/maps/creator_demo/map.json` shows the available fields. High level structure:

```json
{
  "id": "creator_demo",
  "type": "tilemap",
  "tileSize": 900,
  "tiles": [
    {
      "coords": [0, 0],
      "baseHeight": 0.0,
      "heightfield": {
        "rows": 33,
        "cols": 33,
        "scale": { "z": 18 },
        "data": [0.1, 0.119, …],
        "material": { "color": "#546e4f" }
      },
      "objects": [
        {
          "type": "box",
          "size": [140, 80, 32],
          "position": [-210, 140, 0],
          "rotationDegrees": [0, 0, 8],
          "material": { "color": "#9aa7b7" }
        },
        {
          "type": "tree",
          "position": [220, 220, 0],
          "scale": 1.1
        }
      ]
    }
  ],
  "fallback": {
    "type": "procedural",
    "seed": "creator_demo:fallback"
  }
}
```

* `coords` – integer tile coordinate `[x, y]`.
* `heightfield` – optional grid of samples (rows × cols) with a vertical `scale`. When omitted, a flat ground plane is used.
* `objects` – optional array of props. Supported types: `box`, `cylinder`, `plane`, and `tree`. Each object can specify `position`, `rotation` (radians) or `rotationDegrees`, and `scale`.
* `fallback` – controls how missing tiles are filled. By default a procedural chunk is generated using the provided `seed`.

Any tile that is not listed in the descriptor automatically falls back to the procedural generator so the world continues seamlessly beyond the authored area.

## Runtime behaviour

* A new **Map Layout** dropdown appears in the Pilot Console. Switching entries rebuilds the streaming world in-place without reloading the page.
* The viewer persists the last selection in `localStorage` and honours a `?map=<id>` query parameter.
* The HUD shows a status string while a new map loads (`loading…` / `ready`).
* Map assets are fetched on demand; descriptors are cached per session once loaded.

Creators can duplicate the demo folder, adjust `map.json`, or point `manifest.json` at their own layout directory to iterate on custom maps.

## Procedural overrides

Procedural entries can provide a `procedural` (or `generator`) block to tune Terra's endless terrain without forking the source. Any omitted values fall back to the defaults that ship with the viewer, so you can override a single field at a time.

```jsonc
{
  "id": "ember-canyon",
  "type": "procedural",
  "seed": 147852369,
  "procedural": {
    "noise": {
      "hills": { "amplitude": 28, "frequency": 0.001 },
      "mountains": { "amplitude": 190, "exponent": 2.6 }
    },
    "colors": {
      "low": "#7a4730",
      "mid": "#c37b3b",
      "high": "#f1d38b",
      "lowThreshold": 12,
      "highThreshold": 86
    },
    "features": { "rivers": false },
    "rocks": { "densityScale": 8, "size": { "min": 8, "max": 32 } }
  }
}
```

Available sections:

* `noise.hills` / `noise.mountains` / `noise.ridges` – per-layer frequency, amplitude, persistence, lacunarity, exponent, and optional XY offsets that drive elevation.
* `plateau` – adjust the flat launch pad radius and blend distances near the world origin.
* `features` – toggle `mountains`, `rocks`, `towns`, or `rivers` on/off.
* `colors` – configure the low/mid/high gradient stops and height thresholds (`highCap` controls when the gradient tops out).
* `mountains`, `rocks`, `towns`, `rivers` – fine-tune feature-specific placement thresholds, spawn counts, and size ranges.

See `viewer/terra/maps.json` for a full example. The `ember-canyon` preset disables rivers and skews the palette toward warm ochres, producing a noticeably drier biome than the balanced default.

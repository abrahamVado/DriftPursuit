# DriftPursuit waypoint file format

The simulation client's autopilot can load external waypoint loops from a JSON
or YAML file. Each waypoint describes the desired `x`, `y`, and `z`
coordinates in the same coordinate space used by the viewer.

## Schema

- The file must contain a top-level list.
- Each entry in the list can be either:
  - an object with explicit `x`, `y`, and `z` fields, or
  - a sequence of exactly three numbers in the order `[x, y, z]`.
- Coordinate values are converted to floating-point numbers and must be
  finite.

## Example (YAML)

```yaml
- x: -800
  y: -400
  z: 1200
- [200, 0, 1300]
- x: 500
  y: 350
  z: 1150
```

## Example (JSON)

```json
[
  {"x": -800, "y": -400, "z": 1200},
  [200, 0, 1300],
  {"x": 500, "y": 350, "z": 1150}
]
```

## Usage

Pass the file path to the simulation client when launching it:

```bash
python client.py --waypoints-file path/to/loop.yaml
```

If the flag is omitted, the client uses the built-in scenic loop defined in
`navigation.build_default_waypoints()`.

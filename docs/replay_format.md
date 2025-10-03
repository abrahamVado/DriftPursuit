# High-Frequency Replay Format

## Bundle Layout
- `header.json` — JSON header describing match metadata for catalogue tooling.
- `manifest.json` — JSON manifest describing paths and cadence metadata.
- `events.jsonl.sz` — Snappy-compressed JSON lines, each describing a gameplay event.
- `frames.bin.zst` — Zstandard-compressed binary stream containing cadence-controlled frame blobs.

## Header Schema
```json
{
  "schema_version": 1,
  "match_seed": "deterministic match seed",
  "terrain_params": {
    "roughness": 0.5
  },
  "file_pointer": "manifest.json"
}
```

1. The `schema_version` tracks compatibility for consumers parsing the header.
2. The `match_seed` captures the deterministic RNG seed broadcast at match start.
3. `terrain_params` stores numeric terrain tuning metadata when available.
4. `file_pointer` references the replay entry point relative to the header file.

## Manifest Schema
```json
{
  "version": 1,
  "created_at": "RFC3339Nano timestamp",
  "frame_interval_ms": 200,
  "events_path": "events.jsonl.sz",
  "frames_path": "frames.bin.zst"
}
```

## Event Line Structure
Each line is a standalone JSON object encoded as UTF-8.
```json
{
  "tick": 1234,
  "simulated_ms": 16000,
  "captured_at": "RFC3339Nano timestamp",
  "type": "event label",
  "payload_b64": "base64 encoded payload"
}
```

### Parsing Steps
1. Decompress `events.jsonl.sz` with Snappy.
2. Split by newline to obtain individual JSON documents.
3. Decode `payload_b64` to obtain the raw event bytes.

## Frame Stream Structure
Frames are stored sequentially inside `frames.bin.zst`.

### Binary Record Layout
| Offset | Size | Description |
| ------ | ---- | ----------- |
| 0      | 8    | Tick (uint64, little-endian) |
| 8      | 8    | Simulated milliseconds (int64, little-endian) |
| 16     | 8    | Capture timestamp in Unix nanoseconds (int64, little-endian) |
| 24     | 4    | Payload length (uint32, little-endian) |
| 28     | N    | Payload bytes |

### Parsing Steps
1. Decompress `frames.bin.zst` with Zstandard.
2. Iterate through the byte stream, reading the fixed-size 28-byte header.
3. Slice the subsequent payload bytes using the decoded length.
4. Advance the cursor and repeat until the stream ends.

## Cadence Guarantee
Frames are flushed to disk at a 5 Hz cadence (every 200 ms). Manual flushes always respect the cadence anchor to prevent burst writes.

## Versioning
The manifest `version` allows additive evolution of the layout. Parsers should reject unknown versions to avoid silent corruption.

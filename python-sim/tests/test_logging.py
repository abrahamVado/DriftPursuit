import json
import sys
from pathlib import Path

MODULE_DIR = Path(__file__).resolve().parents[1]
if str(MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(MODULE_DIR))

import client


def test_make_payload_logger_writes_jsonl(tmp_path):
    log_path = tmp_path / "payload.log"

    plane = client.Plane("plane-test")

    telemetry = client.mk_telemetry(plane, 0.0)
    cake = client.mk_cake_drop(plane, landing_pos=[1.0, 2.0, 3.0], status="delivered")

    with log_path.open("w", encoding="utf-8") as handle:
        logger = client.make_payload_logger(handle)
        logger(telemetry)
        logger(cake)
        handle.flush()

    contents = log_path.read_text(encoding="utf-8").strip().splitlines()
    assert len(contents) == 2

    telemetry_entry = json.loads(contents[0])
    cake_entry = json.loads(contents[1])

    assert telemetry_entry["type"] == "telemetry"
    assert telemetry_entry["id"] == "plane-test"

    assert cake_entry["type"] == "cake_drop"
    assert cake_entry["from"] == "plane-test"
    assert cake_entry["landing_pos"] == [1.0, 2.0, 3.0]
    assert cake_entry["status"] == "delivered"

import json
import pathlib
import sys

import pytest

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from driftpursuit_proto.intent_publisher import IntentControls, IntentPublisher


def test_intent_publisher_emits_clamped_payload() -> None:
    frames: list[str] = []

    publisher = IntentPublisher("pilot-1", frames.append)

    payload = publisher.publish(
        IntentControls(
            throttle=2.0,
            brake=-1.0,
            steer=-2.0,
            handbrake=True,
            gear=15,
            boost=False,
        )
    )

    # //1.- First frame should clamp values and start the sequence at 1.
    assert payload["sequence_id"] == 1
    assert payload["throttle"] == pytest.approx(1.0)
    assert payload["brake"] == pytest.approx(0.0)
    assert payload["steer"] == pytest.approx(-1.0)
    assert payload["gear"] == 9

    raw = frames[-1]
    decoded = json.loads(raw)
    assert decoded["controller_id"] == "pilot-1"
    assert decoded["type"] == "intent"

    publisher.publish(
        IntentControls(
            throttle=-0.25,
            brake=0.5,
            steer=0.25,
            handbrake=False,
            gear=-1,
            boost=True,
        )
    )

    # //2.- Second frame keeps ordering and preserves boolean controls.
    assert publisher.sequence == 2
    decoded_last = json.loads(frames[-1])
    assert decoded_last["boost"] is True
    assert decoded_last["gear"] == -1

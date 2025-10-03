"""Unit tests covering the FSM-based bot archetypes."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Mapping

sys.path.append(str(Path(__file__).resolve().parents[1]))

from bots import (
    AmbusherConfig,
    ChaserConfig,
    CowardConfig,
    PatrolConfig,
    RuntimeToggles,
    build_ambusher_bot,
    build_chaser_bot,
    build_coward_bot,
    build_patrol_bot,
)
from bots.fsm_cli import _build_bot, create_parser


class FakeIntentClient:
    """Minimal IntentClient replacement used for deterministic testing."""

    def __init__(self) -> None:
        self.sent: list[Mapping[str, object]] = []
        self.started = False

    def start(self) -> None:
        # //1.- Tests control streaming manually so the worker is never started.
        self.started = True

    def stop(self) -> None:
        # //2.- Capture shutdown requests without touching network resources.
        self.started = False

    def close(self) -> None:
        # //3.- No resources to release but the method matches the production API.
        return

    def send_intent(self, intent: Mapping[str, object]) -> None:
        # //4.- Record the payload so assertions can inspect the generated commands.
        self.sent.append(dict(intent))


def make_world(position: tuple[float, float], heading: float, target: tuple[float, float], health: float = 1.0) -> Mapping[str, object]:
    # //5.- Assemble a synthetic world diff understood by the test FSMs.
    return {
        "bot": {"position": position, "heading": heading, "health": health},
        "target": {"position": target},
    }


def test_patrol_bot_transitions() -> None:
    # //6.- Verify patrol transitions across patrol, investigate, and return states.
    client = FakeIntentClient()
    config = PatrolConfig(controller_id="patrol", waypoints=[(0, 0), (10, 0)], linger_ticks=1)
    bot = build_patrol_bot(client, config, toggles=RuntimeToggles(allow_handbrake=True), auto_start=False)

    bot.process_diff(make_world((0, 0), 0.0, (100, 0)))
    assert bot.active_state == "patrol"

    bot.process_diff(make_world((1.5, 0), 0.0, (2.0, 0.0)))
    assert bot.active_state == "investigate"
    bot.process_diff(make_world((1.5, 0), 0.0, (2.0, 0.0)))
    assert client.sent[-1]["handbrake"] is True

    bot.process_diff(make_world((1.5, 0), 0.0, (70.0, 0.0)))
    assert bot.active_state == "return"

    bot.process_diff(make_world((10.0, 0), 0.0, (70.0, 0.0)))
    assert bot.active_state == "patrol"
    bot.close()


def test_chaser_bot_attack_cycle() -> None:
    # //7.- Confirm the chaser escalates through search, chase, and attack states.
    client = FakeIntentClient()
    config = ChaserConfig(controller_id="chaser")
    bot = build_chaser_bot(client, config, toggles=RuntimeToggles(allow_boost=True), auto_start=False)

    bot.process_diff(make_world((0, 0), 0.0, (200, 0)))
    assert bot.active_state == "search"

    bot.process_diff(make_world((0, 0), 0.0, (20, 0)))
    assert bot.active_state == "chase"
    bot.process_diff(make_world((0, 0), 0.0, (20, 0)))
    assert client.sent[-1]["boost"] is True

    bot.process_diff(make_world((0, 0), 0.0, (5, 0)))
    assert bot.active_state == "attack"

    bot.process_diff(make_world((0, 0), 0.0, (30, 0)))
    assert bot.active_state == "chase"
    bot.close()


def test_coward_bot_retreat_and_recover() -> None:
    # //8.- Ensure the coward retreats on low health and re-engages when safe.
    client = FakeIntentClient()
    config = CowardConfig(controller_id="coward")
    bot = build_coward_bot(client, config, toggles=RuntimeToggles(allow_boost=True), auto_start=False)

    bot.process_diff(make_world((0, 0), 0.0, (10, 0), health=0.3))
    assert bot.active_state == "retreat"

    bot.process_diff(make_world((0, 0), 0.0, (70, 0), health=0.3))
    assert bot.active_state == "recover"

    for _ in range(8):
        bot.process_diff(make_world((0, 0), 0.0, (70, 0), health=0.8))
    assert bot.active_state == "harass"
    bot.close()


def test_ambusher_bot_cycle() -> None:
    # //9.- Validate the ambusher flows through hide, stalk, strike, and evade states.
    client = FakeIntentClient()
    config = AmbusherConfig(controller_id="ambusher")
    bot = build_ambusher_bot(client, config, toggles=RuntimeToggles(allow_boost=True), auto_start=False)

    bot.process_diff(make_world((0, 0), 0.0, (50, 0)))
    assert bot.active_state == "stalk"

    for _ in range(3):
        bot.process_diff(make_world((0, 0), 0.0, (20, 0)))
    assert bot.active_state == "strike"

    for _ in range(6):
        bot.process_diff(make_world((0, 0), 0.0, (120, 0)))
    bot.process_diff(make_world((0, 0), 0.0, (200, 0)))
    assert bot.active_state == "hide"
    bot.close()


def test_cli_dry_run_configures_patrol_bot(tmp_path) -> None:
    # //10.- Exercise the CLI builder to confirm flags feed into the patrol bot.
    diff_file = tmp_path / "diffs.jsonl"
    diff_file.write_text(
        "\n".join(
            [
                json.dumps(make_world((0, 0), 0.0, (100, 0))),
                json.dumps(make_world((1.0, 0), 0.0, (2.0, 0))),
            ]
        ),
        encoding="utf-8",
    )
    parser = create_parser()
    args = parser.parse_args(
        [
            "patrol",
            "--client-id",
            "cli",
            "--waypoints",
            "0,0;10,0",
            "--allow-handbrake",
            "--dry-run",
            "--diff-log",
            str(diff_file),
        ]
    )
    bot = _build_bot(args)
    try:
        for diff in (json.loads(line) for line in diff_file.read_text(encoding="utf-8").splitlines()):
            bot.process_diff(diff)
        assert bot.active_state == "investigate"
    finally:
        bot.close()

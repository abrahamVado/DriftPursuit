"""Command line interface for running FSM-based bots."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Iterator, List, Sequence

from . import (
    AmbusherConfig,
    ChaserConfig,
    CowardConfig,
    FSMIntentBot,
    PatrolConfig,
    RuntimeToggles,
    build_ambusher_bot,
    build_chaser_bot,
    build_coward_bot,
    build_patrol_bot,
)
from ._sdk import IntentClient

class _RecordingIntentClient(IntentClient):
    """Intent client variant that records intents instead of streaming."""

    def __init__(self, client_id: str) -> None:
        # //1.- Bypass the base class initialiser because tests inject this stub directly.
        self._client_id = client_id
        self.sent: List[dict[str, object]] = []

    def start(self) -> None:  # pragma: no cover - trivial method
        # //2.- Stub start to preserve the IntentClient API surface.
        return

    def stop(self):  # pragma: no cover - trivial method
        # //3.- Return a sentinel acknowledgement structure to satisfy callers.
        return None

    def close(self) -> None:  # pragma: no cover - trivial method
        # //4.- No resources are allocated so there is nothing to release.
        return

    def send_intent(self, intent):
        # //5.- Store the payload so tests can assert over generated intents.
        self.sent.append(dict(intent))


def _parse_waypoints(raw: str) -> List[tuple[float, float]]:
    # //6.- Split the incoming string into comma-separated coordinate pairs.
    pairs = [item.strip() for item in raw.split(";") if item.strip()]
    waypoints: List[tuple[float, float]] = []
    for pair in pairs:
        x_str, y_str = pair.split(",")
        waypoints.append((float(x_str), float(y_str)))
    return waypoints


def _diff_stream(path: str | None) -> Iterator[dict[str, object]]:
    # //7.- Yield JSON decoded diffs from stdin or the provided file path.
    stream = sys.stdin if path in (None, "-") else open(path, "r", encoding="utf-8")
    try:
        for line in stream:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)
    finally:
        if stream is not sys.stdin:
            stream.close()


def create_parser() -> argparse.ArgumentParser:
    # //8.- Construct the top-level parser shared across tests and runtime execution.
    parser = argparse.ArgumentParser(description="Run FSM-based Drift Pursuit bots")
    parser.add_argument("archetype", choices=["patrol", "chaser", "coward", "ambusher"], help="Bot archetype to run")
    parser.add_argument("--address", default="127.0.0.1:43127", help="Broker gRPC endpoint")
    parser.add_argument("--client-id", required=True, help="Unique controller identifier")
    parser.add_argument("--rate-hz", type=float, default=10.0, help="Intent streaming rate")
    parser.add_argument("--allow-boost", action="store_true", help="Enable boost usage when applicable")
    parser.add_argument("--allow-handbrake", action="store_true", help="Enable handbrake usage where supported")
    parser.add_argument("--diff-log", default="-", help="Path to newline-delimited JSON diffs (default: stdin)")
    parser.add_argument("--dry-run", action="store_true", help="Record intents locally instead of streaming")

    patrol = parser.add_argument_group("patrol", "Patrol bot options")
    patrol.add_argument("--waypoints", help="Semicolon separated list of x,y waypoint coordinates")
    patrol.add_argument("--alert-distance", type=float, default=30.0)
    patrol.add_argument("--linger-ticks", type=int, default=12)
    patrol.add_argument("--patrol-throttle", type=float, default=0.4)

    chaser = parser.add_argument_group("chaser", "Chaser bot options")
    chaser.add_argument("--engage-distance", type=float, default=50.0)
    chaser.add_argument("--attack-distance", type=float, default=9.0)
    chaser.add_argument("--chase-throttle", type=float, default=0.85)

    coward = parser.add_argument_group("coward", "Coward bot options")
    coward.add_argument("--harass-distance", type=float, default=40.0)
    coward.add_argument("--retreat-distance", type=float, default=55.0)
    coward.add_argument("--safe-health", type=float, default=0.45)
    coward.add_argument("--retreat-throttle", type=float, default=0.95)

    ambusher = parser.add_argument_group("ambusher", "Ambusher bot options")
    ambusher.add_argument("--detection-distance", type=float, default=60.0)
    ambusher.add_argument("--ambush-distance", type=float, default=25.0)
    ambusher.add_argument("--strike-throttle", type=float, default=1.0)
    ambusher.add_argument("--stalk-throttle", type=float, default=0.35)
    return parser


def _build_bot(args: argparse.Namespace) -> FSMIntentBot:
    # //9.- Instantiate the requested bot archetype with the provided configuration.
    toggles = RuntimeToggles(allow_boost=args.allow_boost, allow_handbrake=args.allow_handbrake)
    if args.dry_run:
        client = _RecordingIntentClient(args.client_id)
        auto_start = False
    else:
        client = IntentClient(args.address, args.client_id, rate_hz=args.rate_hz)
        auto_start = True

    if args.archetype == "patrol":
        if not args.waypoints:
            raise ValueError("--waypoints must be provided for patrol archetype")
        config = PatrolConfig(
            controller_id=args.client_id,
            waypoints=_parse_waypoints(args.waypoints),
            alert_distance=args.alert_distance,
            linger_ticks=args.linger_ticks,
            patrol_throttle=args.patrol_throttle,
        )
        return build_patrol_bot(client, config, toggles=toggles, auto_start=auto_start)

    if args.archetype == "chaser":
        config = ChaserConfig(
            controller_id=args.client_id,
            engage_distance=args.engage_distance,
            attack_distance=args.attack_distance,
            chase_throttle=args.chase_throttle,
        )
        return build_chaser_bot(client, config, toggles=toggles, auto_start=auto_start)

    if args.archetype == "coward":
        config = CowardConfig(
            controller_id=args.client_id,
            harass_distance=args.harass_distance,
            retreat_distance=args.retreat_distance,
            safe_health=args.safe_health,
            retreat_throttle=args.retreat_throttle,
        )
        return build_coward_bot(client, config, toggles=toggles, auto_start=auto_start)

    config = AmbusherConfig(
        controller_id=args.client_id,
        detection_distance=args.detection_distance,
        ambush_distance=args.ambush_distance,
        strike_throttle=args.strike_throttle,
        stalk_throttle=args.stalk_throttle,
    )
    return build_ambusher_bot(client, config, toggles=toggles, auto_start=auto_start)


def run(args: Sequence[str] | None = None) -> int:
    # //10.- Parse arguments, run the bot against the diff stream, and flush intents.
    parser = create_parser()
    parsed = parser.parse_args(args)
    bot = _build_bot(parsed)
    try:
        for diff in _diff_stream(parsed.diff_log):
            bot.process_diff(diff)
    except KeyboardInterrupt:  # pragma: no cover - manual interruption
        return 130
    finally:
        bot.close()
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised by manual runs
    sys.exit(run())

# FSM Bot Archetypes

The Python simulation now ships with four finite-state-machine driven bots that
consume the shared intent streaming SDK. Each archetype can be configured via
the `python -m bots.fsm_cli` entry point and demonstrated with lightweight
replay snippets stored under `python-sim/bots/replays`.

## Common Usage

```bash
python -m bots.fsm_cli <archetype> --client-id demo --dry-run --diff-log demo.jsonl \
  --allow-boost --allow-handbrake
```

The CLI accepts newline-delimited JSON diffs and writes intents through the
shared `IntentClient`. Using `--dry-run` swaps the network client for an
in-memory recorder so the behaviours can be inspected without a running broker.

## Patrol Bot

* States: patrol → investigate → return.
* Important flags: `--waypoints`, `--alert-distance`, `--linger-ticks`,
  `--patrol-throttle`, `--allow-handbrake`.
* Demonstration replay: `python-sim/bots/replays/patrol.jsonl`.

## Chaser Bot

* States: search → chase → attack.
* Important flags: `--engage-distance`, `--attack-distance`, `--chase-throttle`,
  `--allow-boost`.
* Demonstration replay: `python-sim/bots/replays/chaser.jsonl`.

## Coward Bot

* States: harass → retreat → recover.
* Important flags: `--harass-distance`, `--retreat-distance`, `--safe-health`,
  `--retreat-throttle`, `--allow-boost`.
* Demonstration replay: `python-sim/bots/replays/coward.jsonl`.

## Ambusher Bot

* States: hide → stalk → strike → evade.
* Important flags: `--detection-distance`, `--ambush-distance`,
  `--strike-throttle`, `--stalk-throttle`, `--allow-boost`.
* Demonstration replay: `python-sim/bots/replays/ambusher.jsonl`.

Each replay captures two representative diffs to visualise the transition flow.
Pair the snippets with the CLI dry-run mode to observe the generated intents
without connecting to the live broker.

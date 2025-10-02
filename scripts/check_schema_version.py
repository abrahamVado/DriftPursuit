#!/usr/bin/env python3
"""Validate protobuf schema versioning rules for the v0.x series."""
from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_FILE = REPO_ROOT / "proto" / "SCHEMA_VERSION"
PROTO_DIR = REPO_ROOT / "proto"

SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def run_git(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=REPO_ROOT, text=True, capture_output=True)


def parse_semver(raw: str) -> tuple[int, int, int]:
    match = SEMVER_RE.match(raw.strip())
    if not match:
        raise ValueError(f"invalid semver string: {raw!r}")
    major, minor, patch = map(int, match.groups())
    return major, minor, patch


def get_previous_schema_version() -> tuple[int, int, int] | None:
    result = run_git(["show", "origin/main:proto/SCHEMA_VERSION"])
    if result.returncode != 0:
        return None
    try:
        return parse_semver(result.stdout.strip())
    except ValueError:
        return None


def ensure_fetch_main() -> None:
    fetch = subprocess.run(
        ["git", "fetch", "--no-tags", "--depth", "1", "origin", "main"],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
    )
    if fetch.returncode != 0 and "fatal" in fetch.stderr.lower():
        # In environments without network access (e.g., local hooks), best effort only.
        print("warning: unable to fetch origin/main, skipping diff-based checks", file=sys.stderr)
        raise RuntimeError("fetch failed")


def proto_files_changed() -> bool:
    result = run_git(["diff", "--name-only", "origin/main...HEAD", "--", "proto"])
    if result.returncode != 0:
        return False
    return any(path.strip().endswith(".proto") for path in result.stdout.splitlines())


def schema_file_changed() -> bool:
    result = run_git(["diff", "--name-only", "origin/main...HEAD", "--", "proto/SCHEMA_VERSION"])
    if result.returncode != 0:
        return False
    return bool(result.stdout.strip())


def verify_schema_version_field(proto_path: Path) -> None:
    content = proto_path.read_text(encoding="utf-8")
    if "schema_version" not in content:
        raise SystemExit(f"{proto_path}: missing schema_version field")
    if not re.search(r"uint32\s+schema_version\s*=\s*1\s*;", content):
        raise SystemExit(f"{proto_path}: schema_version must be field number 1 of type uint32")


def main() -> None:
    if not SCHEMA_FILE.exists():
        raise SystemExit("proto/SCHEMA_VERSION is missing")

    for proto_path in PROTO_DIR.rglob("*.proto"):
        verify_schema_version_field(proto_path)

    current = parse_semver(SCHEMA_FILE.read_text(encoding="utf-8"))
    if current[0] != 0:
        raise SystemExit("schema version must remain in the v0.x range while compatibility rules are enforced")

    try:
        ensure_fetch_main()
    except RuntimeError:
        # Without origin/main we cannot perform diff comparisons, but the basic
        # format checks above have already run.
        return

    previous = get_previous_schema_version()
    changed_proto = proto_files_changed()
    schema_changed = schema_file_changed()

    if changed_proto and not schema_changed:
        raise SystemExit("protobuf definitions changed without bumping proto/SCHEMA_VERSION")

    if previous is None:
        return

    if not changed_proto and schema_changed:
        raise SystemExit("schema version bumped without modifying any protobuf definitions")

    if not changed_proto:
        # Nothing changed; ensure version stayed put.
        if current != previous:
            raise SystemExit("schema version changed but no protobuf definitions were modified")
        return

    if current <= previous:
        raise SystemExit(
            f"schema version {current[0]}.{current[1]}.{current[2]} must increase over {previous[0]}.{previous[1]}.{previous[2]}"
        )

    if current[0] != previous[0]:
        raise SystemExit("major version changes are not allowed while enforcing v0.x compatibility")


if __name__ == "__main__":
    main()

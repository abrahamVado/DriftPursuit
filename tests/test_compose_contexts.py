"""Tests ensuring docker-compose contexts reference existing directories."""
from __future__ import annotations

import pathlib
import re
import unittest


class ComposeContextTest(unittest.TestCase):
    # //1.- Locate the docker-compose.yml file relative to the repository root.
    COMPOSE_PATH = pathlib.Path(__file__).resolve().parent.parent / "docker-compose.yml"

    def test_all_build_contexts_exist(self) -> None:
        """Each build context path declared in docker-compose.yml must exist."""
        # //2.- Read the compose file contents as raw text to avoid YAML dependencies.
        contents = self.COMPOSE_PATH.read_text(encoding="utf-8")
        # //3.- Extract every build context using a regex that captures relative paths.
        contexts = re.findall(r"^\s*context:\s+(.+)$", contents, flags=re.MULTILINE)
        missing_paths: list[str] = []
        for raw_path in contexts:
            # //4.- Normalise quotes and leading './' segments before resolving the path.
            cleaned = raw_path.strip().strip('"').strip("'")
            if cleaned.startswith("./"):
                cleaned = cleaned[2:]
            resolved_path = self.COMPOSE_PATH.parent / cleaned
            if not resolved_path.exists():
                missing_paths.append(cleaned or ".")
        # //5.- Fail the test when any context path is absent so Compose builds cannot break silently.
        self.assertFalse(missing_paths, f"Missing build contexts: {missing_paths}")


if __name__ == "__main__":
    unittest.main()

"""Pytest configuration for tunnelcave sandbox tests."""
from __future__ import annotations

import sys
from pathlib import Path

# //1.- Ensure repository root is available on the Python path for package imports.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

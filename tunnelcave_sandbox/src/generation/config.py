"""Configuration helpers for deterministic tunnel cave generation."""
from __future__ import annotations

import os
import random
from dataclasses import dataclass
from typing import Dict, Optional

# //1.- Define dataclass to encapsulate generation seeds for reproducibility.
@dataclass(frozen=True)
class GenerationSeeds:
    """Seeds driving the stochastic parts of cave generation."""

    divergence_seed: int = 0
    path_seed: int = 0

    # //2.- Provide helper to mutate seeds from mapping when available.
    @classmethod
    def from_mapping(cls, payload: Optional[Dict[str, int]] = None) -> "GenerationSeeds":
        if not payload:
            return cls()
        return cls(
            divergence_seed=int(payload.get("divergence_seed", 0)),
            path_seed=int(payload.get("path_seed", 0)),
        )

    # //3.- Allow overriding seeds through environment variables for integration tests.
    @classmethod
    def from_environment(cls, prefix: str = "TUNNELCAVE") -> "GenerationSeeds":
        divergence = os.getenv(f"{prefix}_DIVERGENCE_SEED")
        path = os.getenv(f"{prefix}_PATH_SEED")
        mapping: Dict[str, int] = {}
        if divergence is not None:
            mapping["divergence_seed"] = int(divergence)
        if path is not None:
            mapping["path_seed"] = int(path)
        return cls.from_mapping(mapping)

    # //4.- Utility returning numpy RNG objects for each subsystem.
    def create_generators(self) -> Dict[str, random.Random]:
        return {
            "divergence": random.Random(self.divergence_seed),
            "path": random.Random(self.path_seed),
        }


# //5.- Provide canonical configuration accessor used across modules.
def load_generation_config(
    mapping: Optional[Dict[str, int]] = None,
    *,
    env_prefix: str = "TUNNELCAVE",
) -> GenerationSeeds:
    if mapping is not None:
        return GenerationSeeds.from_mapping(mapping)
    return GenerationSeeds.from_environment(prefix=env_prefix)

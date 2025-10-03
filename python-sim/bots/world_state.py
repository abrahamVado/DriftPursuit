"""Optimised helper for applying nested world state diffs."""

from __future__ import annotations

from typing import List, Mapping, MutableMapping, Tuple


class WorldStateCache:
    """In-place cache that folds incremental diffs into a shared state."""

    def __init__(self) -> None:
        # //1.- Maintain a single mutable root dictionary to minimise allocations across frames.
        self._state: MutableMapping[str, object] = {}
        # //2.- Reuse a scratch stack so nested diffs can be merged without recursion.
        self._scratch: List[Tuple[MutableMapping[str, object], Mapping[str, object]]] = []

    def apply(self, diff: Mapping[str, object]) -> Mapping[str, object]:
        """Merge the provided diff into the cached world snapshot."""

        # //3.- Seed the scratch stack with the root pair so the loop can iterate depth-first.
        self._scratch.append((self._state, diff))
        while self._scratch:
            target, delta = self._scratch.pop()
            for key, value in delta.items():
                if isinstance(value, Mapping):
                    # //4.- Reuse existing nested dictionaries to avoid churn while recursing.
                    child = target.get(key)
                    if not isinstance(child, MutableMapping):
                        child = {}
                        target[key] = child
                    self._scratch.append((child, value))
                else:
                    # //5.- Write leaf values directly because scalars fully replace prior state.
                    target[key] = value
        # //6.- Clear the scratch space so the next invocation starts fresh without reallocations.
        self._scratch.clear()
        return self._state

    def reset(self) -> None:
        """Drop cached state so a fresh match can begin cleanly."""

        # //7.- Clear nested dictionaries recursively by replacing the root mapping.
        self._state = {}
        self._scratch.clear()


__all__ = ["WorldStateCache"]

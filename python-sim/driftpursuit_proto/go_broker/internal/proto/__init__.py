"""Protocol buffer modules for the Go broker internal schema."""

import sys
import types

package_module = sys.modules.get("go_broker")
if package_module is None:
    package_module = types.ModuleType("go_broker")
    sys.modules["go_broker"] = package_module
if not hasattr(package_module, "__path__"):
    package_module.__path__ = []  # type: ignore[attr-defined]

internal_module = sys.modules.get("go_broker.internal")
if internal_module is None:
    internal_module = types.ModuleType("go_broker.internal")
    sys.modules["go_broker.internal"] = internal_module
if not hasattr(internal_module, "__path__"):
    internal_module.__path__ = []  # type: ignore[attr-defined]

setattr(package_module, "internal", internal_module)
setattr(internal_module, "proto", sys.modules.get(__name__, types.ModuleType(__name__)))
sys.modules["go_broker.internal.proto"] = sys.modules.get(__name__)

from . import events_pb2, radar_pb2, snapshots_pb2, types_pb2, vehicle_pb2

__all__ = [
    "events_pb2",
    "radar_pb2",
    "snapshots_pb2",
    "types_pb2",
    "vehicle_pb2",
]

# Ensure the alias references the fully initialised module.
internal_module.proto = sys.modules[__name__]
sys.modules["go_broker.internal.proto"] = sys.modules[__name__]

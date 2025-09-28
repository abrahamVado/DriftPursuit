import json
import sys
import tempfile
from pathlib import Path
from unittest import mock, TestCase

SIM_DIR = Path(__file__).resolve().parents[1]
if str(SIM_DIR) not in sys.path:
    sys.path.insert(0, str(SIM_DIR))

import client  # type: ignore  # noqa: E402
import navigation  # type: ignore  # noqa: E402


class LoadWaypointsTests(TestCase):
    def test_loads_json_waypoints(self) -> None:
        data = [
            {"x": -10, "y": 5, "z": 1000},
            [20, 0, 900],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "loop.json")
            path.write_text(json.dumps(data))

            result = navigation.load_waypoints_from_file(path)

        self.assertEqual(len(result), 2)
        self.assertTrue(all(isinstance(wp, navigation.Waypoint) for wp in result))
        self.assertEqual(result[0], navigation.Waypoint(-10.0, 5.0, 1000.0))
        self.assertEqual(result[1], navigation.Waypoint(20.0, 0.0, 900.0))

    def test_loads_yaml_waypoints(self) -> None:
        yaml_payload = """
        - x: 1
          y: 2
          z: 3
        - [4, 5, 6]
        """
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "loop.yaml")
            path.write_text(yaml_payload)

            result = navigation.load_waypoints_from_file(path)

        self.assertEqual(result, [
            navigation.Waypoint(1.0, 2.0, 3.0),
            navigation.Waypoint(4.0, 5.0, 6.0),
        ])

    def test_rejects_non_finite_coordinate(self) -> None:
        data = [{"x": 1, "y": "nan", "z": 2}]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp, "loop.json")
            path.write_text(json.dumps(data))

            with self.assertRaisesRegex(ValueError, "non-finite"):
                navigation.load_waypoints_from_file(path)


class ResolveWaypointsTests(TestCase):
    def test_defaults_to_builtin_waypoints(self) -> None:
        with mock.patch("client.build_default_waypoints") as default_builder:
            default_builder.return_value = [
                navigation.Waypoint(1.0, 2.0, 3.0),
                navigation.Waypoint(4.0, 5.0, 6.0),
            ]

            result = client.resolve_waypoints(None)

        self.assertEqual(result, default_builder.return_value)
        default_builder.assert_called_once_with()

    def test_returns_copy_of_custom_waypoints(self) -> None:
        custom_waypoints = [navigation.Waypoint(0.0, 0.0, 1.0)]
        result = client.resolve_waypoints(custom_waypoints)
        self.assertEqual(result, custom_waypoints)
        self.assertIsNot(result, custom_waypoints)

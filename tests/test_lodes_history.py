from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import pandas as pd

from flathead_economic.lodes_history import LodesHistoryUpdater


class LodesAggregateTests(unittest.TestCase):
    def _write_gzip(self, directory: str, frame: pd.DataFrame) -> Path:
        path = Path(directory) / "sample.csv.gz"
        frame.to_csv(path, index=False, compression="gzip")
        return path

    def test_aggregates_only_flathead_blocks_to_block_groups(self) -> None:
        source = pd.DataFrame(
            {
                "year": [2023, 2023, 2023],
                "h_geocode": [
                    "300290001001001",
                    "300290001001002",
                    "300310001001001",
                ],
                "C000": [10, 7, 999],
            }
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self._write_gzip(temp_dir, source)
            updater = LodesHistoryUpdater.__new__(LodesHistoryUpdater)
            result = updater._aggregate(path, "h_geocode", 2023)

        self.assertEqual(result.to_dict("records"), [{"GEOID": "300290001001", "jobs": 17}])

    def test_aggregates_early_release_without_year_column(self) -> None:
        source = pd.DataFrame(
            {
                "h_geocode": ["300290001001001", "300290001001002"],
                "C000": [4, 6],
            }
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self._write_gzip(temp_dir, source)
            updater = LodesHistoryUpdater.__new__(LodesHistoryUpdater)
            result = updater._aggregate(path, "h_geocode", 2002)

        self.assertEqual(result.to_dict("records"), [{"GEOID": "300290001001", "jobs": 10}])

    def test_rejects_wrong_year(self) -> None:
        source = pd.DataFrame(
            {
                "year": [2022],
                "h_geocode": ["300290001001001"],
                "C000": [10],
            }
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            path = self._write_gzip(temp_dir, source)
            updater = LodesHistoryUpdater.__new__(LodesHistoryUpdater)
            with self.assertRaisesRegex(RuntimeError, "Expected only 2023"):
                updater._aggregate(path, "h_geocode", 2023)


if __name__ == "__main__":
    unittest.main()

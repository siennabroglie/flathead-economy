from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urljoin

import geopandas as gpd
import pandas as pd
import requests


BASE_URL = "https://lehd.ces.census.gov/data/lodes/LODES8/mt"
COUNTY_GEOID_PREFIX = "30029"
CHUNK_SIZE = 250_000


class LodesHistoryUpdater:
    """Download official annual Montana LODES RAC/WAC files and publish immutable Flathead summaries."""

    def __init__(self, config_path: Path):
        self.config_path = config_path
        self.root = config_path.resolve().parent.parent
        self.raw_dir = self.root / "raw" / "lodes" / "official"
        self.data_dir = self.root / "data" / "lodes"
        self.meta_dir = self.root / "metadata"
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.meta_dir.mkdir(parents=True, exist_ok=True)
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "flathead-economy-data-pipeline/1.0"})

    def _get(self, url: str) -> requests.Response:
        response = self.session.get(url, timeout=180)
        response.raise_for_status()
        return response

    @staticmethod
    def _sha256(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def _available_years(self, kind: str) -> dict[int, str]:
        if kind not in {"rac", "wac"}:
            raise ValueError(f"Unsupported LODES type: {kind}")
        directory_url = f"{BASE_URL}/{kind}/"
        response = self._get(directory_url)
        pattern = re.compile(
            rf'href=["\'](mt_{kind}_S000_JT00_(20\d{{2}})\.csv\.gz)["\']',
            re.IGNORECASE,
        )
        files: dict[int, str] = {}
        for filename, year_text in pattern.findall(response.text):
            files[int(year_text)] = urljoin(directory_url, filename)
        if not files:
            raise RuntimeError(
                f"No official {kind.upper()} S000/JT00 annual files found at {directory_url}"
            )
        return files

    def _download(self, url: str, destination: Path) -> None:
        if destination.exists() and destination.stat().st_size > 0:
            return
        response = self._get(url)
        payload = response.content
        if not payload.startswith(b"\x1f\x8b"):
            raise RuntimeError(f"Expected a gzip-compressed LODES file from {url}")
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        temporary.write_bytes(payload)
        temporary.replace(destination)

    def _aggregate(self, path: Path, geo_column: str, expected_year: int) -> pd.DataFrame:
        header = pd.read_csv(path, compression="gzip", nrows=0).columns.tolist()
        required = {geo_column, "C000"}
        missing = required - set(header)
        if missing:
            raise RuntimeError(f"{path.name} is missing columns: {sorted(missing)}")

        # Some early LODES releases omit the year column; their year is
        # authoritative in the official annual filename discovered upstream.
        has_year_column = "year" in header
        usecols = [geo_column, "C000"] + (["year"] if has_year_column else [])

        chunks: list[pd.DataFrame] = []
        for chunk in pd.read_csv(
            path,
            compression="gzip",
            usecols=usecols,
            dtype={geo_column: "string"},
            chunksize=CHUNK_SIZE,
        ):
            if has_year_column:
                years_in_file = pd.to_numeric(chunk["year"], errors="raise")
                if not years_in_file.eq(expected_year).all():
                    raise RuntimeError(
                        f"Expected only {expected_year} rows in {path.name}; found years {sorted(years_in_file.unique().tolist())}"
                    )
            geocodes = chunk[geo_column].str.zfill(15)
            county_mask = geocodes.str.startswith(COUNTY_GEOID_PREFIX)
            chunk = chunk.loc[county_mask, [geo_column, "C000"]].copy()
            if chunk.empty:
                continue
            geocodes = chunk[geo_column].astype("string").str.zfill(15)
            if not geocodes.str.fullmatch(r"30029\d{10}").all():
                raise RuntimeError(f"Unexpected Flathead Census block GEOID in {path.name}")
            jobs = pd.to_numeric(chunk["C000"], errors="raise")
            if (jobs < 0).any():
                raise RuntimeError(f"Negative C000 job counts found in {path.name}")
            block_groups = geocodes.str[:12]
            grouped = pd.DataFrame({"GEOID": block_groups, "jobs": jobs})
            chunks.append(grouped.groupby("GEOID", as_index=False)["jobs"].sum())

        if not chunks:
            raise RuntimeError(f"No Flathead County records found in {path.name}")
        return (
            pd.concat(chunks, ignore_index=True)
            .groupby("GEOID", as_index=False)["jobs"]
            .sum()
        )

    def _county_block_groups(self) -> list[str]:
        boundary_archives = sorted((self.root / "raw" / "census").glob("*_bg.zip"))
        if not boundary_archives:
            raise FileNotFoundError(
                "No TIGER block-group ZIP found under raw/census/. Run the normal fetch step first."
            )
        boundaries = gpd.read_file(f"zip://{boundary_archives[-1].resolve()}")
        required = {"GEOID", "STATEFP", "COUNTYFP"}
        missing = required - set(boundaries.columns)
        if missing:
            raise RuntimeError(f"TIGER block-group file missing fields: {sorted(missing)}")
        county = boundaries[
            (boundaries["STATEFP"].astype(str).str.zfill(2) == "30")
            & (boundaries["COUNTYFP"].astype(str).str.zfill(3) == "029")
        ]
        geoids = county["GEOID"].astype(str).str.zfill(12).tolist()
        if not geoids or len(geoids) != len(set(geoids)):
            raise RuntimeError("TIGER Flathead block-group GEOIDs are empty or duplicated")
        return sorted(geoids)

    def run(self, rebuild_existing: bool = False) -> dict:
        rac_urls = self._available_years("rac")
        wac_urls = self._available_years("wac")
        years = sorted(set(rac_urls) & set(wac_urls))
        if not years:
            raise RuntimeError("No years have both official Montana RAC and WAC files")

        geoids = self._county_block_groups()
        releases: dict[str, dict] = {}
        manifest_path = self.meta_dir / "lodes_history_manifest.json"
        if manifest_path.exists():
            try:
                existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                releases.update(existing_manifest.get("releases", {}))
            except (OSError, json.JSONDecodeError):
                raise RuntimeError(f"Existing LODES manifest is unreadable: {manifest_path}")

        created: list[int] = []
        skipped: list[int] = []
        for year in years:
            year_dir = self.data_dir / str(year)
            csv_path = year_dir / "flathead_lodes_jobs_by_block_group.csv"
            summary_path = year_dir / "build_summary.json"
            if csv_path.exists() and summary_path.exists() and not rebuild_existing:
                skipped.append(year)
                continue
            if year_dir.exists() and any(year_dir.iterdir()) and not rebuild_existing:
                raise RuntimeError(
                    f"{year_dir} already contains files but is not a complete LODES history release. "
                    "Inspect it and move it aside, or explicitly run with --rebuild-existing."
                )

            rac_url = rac_urls[year]
            wac_url = wac_urls[year]
            rac_path = self.raw_dir / Path(rac_url).name
            wac_path = self.raw_dir / Path(wac_url).name
            self._download(rac_url, rac_path)
            self._download(wac_url, wac_path)

            rac = self._aggregate(rac_path, "h_geocode", year).rename(columns={"jobs": "rac_jobs"})
            wac = self._aggregate(wac_path, "w_geocode", year).rename(columns={"jobs": "wac_jobs"})
            frame = pd.DataFrame({"GEOID": geoids})
            frame = frame.merge(rac, on="GEOID", how="left", validate="one_to_one")
            frame = frame.merge(wac, on="GEOID", how="left", validate="one_to_one")
            frame["year"] = year
            frame = frame[["year", "GEOID", "rac_jobs", "wac_jobs"]]
            if len(frame) != len(geoids) or frame["GEOID"].duplicated().any():
                raise RuntimeError(f"Invalid block-group row count or duplicate GEOIDs for {year}")
            if not frame["GEOID"].str.fullmatch(r"30029\d{7}").all():
                raise RuntimeError(f"Unexpected block-group GEOID in {year} output")
            if frame["rac_jobs"].notna().sum() == 0 or frame["wac_jobs"].notna().sum() == 0:
                raise RuntimeError(f"LODES {year} output has no matched RAC or WAC values")

            year_dir.mkdir(parents=True, exist_ok=True)
            frame.to_csv(csv_path, index=False)
            summary = {
                "year": year,
                "county": "Flathead County, Montana",
                "source": "U.S. Census Bureau LEHD LODES 8",
                "source_urls": {"rac": rac_url, "wac": wac_url},
                "source_sha256": {
                    "rac": self._sha256(rac_path),
                    "wac": self._sha256(wac_path),
                },
                "output": str(csv_path.relative_to(self.root)),
                "block_groups": int(len(frame)),
                "rac_block_groups_with_data": int(frame["rac_jobs"].notna().sum()),
                "wac_block_groups_with_data": int(frame["wac_jobs"].notna().sum()),
                "rac_jobs_total": int(rac["rac_jobs"].sum()),
                "wac_jobs_total": int(wac["wac_jobs"].sum()),
                "notes": [
                    "C000 is total jobs for the S000/JT00 LODES selection.",
                    "RAC is jobs by worker residence; WAC is jobs by workplace.",
                    "Census block records are aggregated to 12-digit block-group GEOIDs.",
                    "Missing block-group matches remain null and are not converted to zero.",
                    "Published year outputs are immutable during routine runs; use --rebuild-existing only for an intentional rebuild.",
                ],
            }
            summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
            releases[str(year)] = {
                "rac_url": rac_url,
                "wac_url": wac_url,
                "rac_sha256": summary["source_sha256"]["rac"],
                "wac_sha256": summary["source_sha256"]["wac"],
                "output": str(csv_path.relative_to(self.root)),
                "block_groups": int(len(frame)),
            }
            created.append(year)
            print(f"Created immutable LODES history output for {year}: {csv_path}")

        manifest = {
            "source": "U.S. Census Bureau LEHD LODES 8",
            "state": "Montana",
            "county": "Flathead County",
            "selection": "S000/JT00, C000 total jobs",
            "available_years": years,
            "releases": releases,
            "routine_overwrite_policy": "Never overwrite a complete annual output; explicit --rebuild-existing required.",
        }
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        result = {"status": "complete", "available_years": years, "created_years": created, "skipped_existing_years": skipped, "manifest": str(manifest_path.relative_to(self.root))}
        print(json.dumps(result, indent=2))
        return result



def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Download official Montana LODES data and build immutable Flathead County annual history."
    )
    parser.add_argument("--config", default="config/config.yaml")
    parser.add_argument(
        "--rebuild-existing",
        action="store_true",
        help="Intentionally rebuild already published annual LODES outputs.",
    )
    args = parser.parse_args()
    updater = LodesHistoryUpdater(Path(args.config))
    updater.run(rebuild_existing=args.rebuild_existing)


if __name__ == "__main__":
    main()

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

AGE_FIELDS = ("CA01", "CA02", "CA03")
EARNINGS_FIELDS = ("CE01", "CE02", "CE03")
INDUSTRY_FIELDS = tuple(f"CNS{i:02d}" for i in range(1, 21))
RACE_FIELDS = ("CR01", "CR02", "CR03", "CR04", "CR05", "CR07")
ETHNICITY_FIELDS = ("CT01", "CT02")
EDUCATION_FIELDS = ("CD01", "CD02", "CD03", "CD04")
SEX_FIELDS = ("CS01", "CS02")
LODES_CHARACTERISTIC_FIELDS = (
    "C000", *AGE_FIELDS, *EARNINGS_FIELDS, *INDUSTRY_FIELDS,
    *RACE_FIELDS, *ETHNICITY_FIELDS, *EDUCATION_FIELDS, *SEX_FIELDS,
)
DEMOGRAPHIC_FIELDS_AVAILABLE_FROM_2009 = (
    *RACE_FIELDS, *ETHNICITY_FIELDS, *EDUCATION_FIELDS, *SEX_FIELDS,
)


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

    def _aggregate_characteristics(
        self, path: Path, geo_column: str, expected_year: int
    ) -> pd.DataFrame:
        """Aggregate supported LODES worker/job characteristics to block groups."""
        header = pd.read_csv(path, compression="gzip", nrows=0).columns.tolist()
        if geo_column not in header:
            raise RuntimeError(f"{path.name} is missing geography column {geo_column}")

        missing = set(LODES_CHARACTERISTIC_FIELDS) - set(header)
        if missing:
            raise RuntimeError(
                f"{path.name} is missing expected LODES characteristic columns: {sorted(missing)}"
            )

        has_year_column = "year" in header
        usecols = [geo_column, *LODES_CHARACTERISTIC_FIELDS]
        if has_year_column:
            usecols.append("year")

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
                        f"Expected only {expected_year} rows in {path.name}; "
                        f"found years {sorted(years_in_file.unique().tolist())}"
                    )

            geocodes = chunk[geo_column].str.zfill(15)
            chunk = chunk.loc[geocodes.str.startswith(COUNTY_GEOID_PREFIX),
                              [geo_column, *LODES_CHARACTERISTIC_FIELDS]].copy()
            if chunk.empty:
                continue

            geocodes = chunk[geo_column].astype("string").str.zfill(15)
            if not geocodes.str.fullmatch(r"30029\d{10}").all():
                raise RuntimeError(f"Unexpected Flathead Census block GEOID in {path.name}")

            values = chunk[LODES_CHARACTERISTIC_FIELDS].apply(pd.to_numeric, errors="raise")
            if (values < 0).any().any():
                raise RuntimeError(f"Negative LODES characteristic counts found in {path.name}")

            values.insert(0, "GEOID", geocodes.str[:12].to_numpy())
            chunks.append(
                values.groupby("GEOID", as_index=False)[list(LODES_CHARACTERISTIC_FIELDS)].sum()
            )

        if not chunks:
            raise RuntimeError(f"No Flathead County records found in {path.name}")
        return (
            pd.concat(chunks, ignore_index=True)
            .groupby("GEOID", as_index=False)[list(LODES_CHARACTERISTIC_FIELDS)]
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
        created_characteristics: list[int] = []
        skipped: list[int] = []
        for year in years:
            year_dir = self.data_dir / str(year)
            csv_path = year_dir / "flathead_lodes_jobs_by_block_group.csv"
            summary_path = year_dir / "build_summary.json"
            characteristics_path = year_dir / "flathead_lodes_characteristics_by_block_group.csv"
            characteristics_summary_path = year_dir / "characteristics_summary.json"

            totals_complete = csv_path.exists() and summary_path.exists()
            characteristics_complete = (
                characteristics_path.exists() and characteristics_summary_path.exists()
            )
            if (
                not rebuild_existing
                and characteristics_path.exists() != characteristics_summary_path.exists()
            ):
                raise RuntimeError(
                    f"{year_dir} contains a partial characteristics release. "
                    "Inspect it or explicitly run with --rebuild-existing."
                )
            if not rebuild_existing and totals_complete and characteristics_complete:
                skipped.append(year)
                release = releases.setdefault(str(year), {})
                release.update({
                    "output": str(csv_path.relative_to(self.root)),
                    "characteristics_output": str(characteristics_path.relative_to(self.root)),
                    "block_groups": len(geoids),
                })
                continue
            if (
                year_dir.exists()
                and any(year_dir.iterdir())
                and not rebuild_existing
                and not totals_complete
            ):
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

            rac_all = self._aggregate_characteristics(rac_path, "h_geocode", year)
            wac_all = self._aggregate_characteristics(wac_path, "w_geocode", year)
            rac = rac_all[["GEOID", "C000"]].rename(columns={"C000": "rac_jobs"})
            wac = wac_all[["GEOID", "C000"]].rename(columns={"C000": "wac_jobs"})

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
            if not totals_complete or rebuild_existing:
                frame.to_csv(csv_path, index=False)
                summary = {
                    "year": year,
                    "county": "Flathead County, Montana",
                    "source": "U.S. Census Bureau LEHD LODES 8",
                    "source_urls": {"rac": rac_url, "wac": wac_url},
                    "source_sha256": {"rac": self._sha256(rac_path), "wac": self._sha256(wac_path)},
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
                created.append(year)

            characteristics = pd.DataFrame({"GEOID": geoids})
            rac_characteristics = rac_all.rename(
                columns={field: f"rac_{field}" for field in LODES_CHARACTERISTIC_FIELDS if field != "C000"}
            ).rename(columns={"C000": "rac_jobs"})
            wac_characteristics = wac_all.rename(
                columns={field: f"wac_{field}" for field in LODES_CHARACTERISTIC_FIELDS if field != "C000"}
            ).rename(columns={"C000": "wac_jobs"})
            characteristics = characteristics.merge(
                rac_characteristics, on="GEOID", how="left", validate="one_to_one"
            )
            characteristics = characteristics.merge(
                wac_characteristics, on="GEOID", how="left", validate="one_to_one"
            )
            characteristics.insert(0, "year", year)

            # These characteristics are not published for 2002-2008. Do not
            # expose their placeholder zeros as observed data.
            if year < 2009:
                unavailable_columns = [
                    f"{basis}_{field}"
                    for basis in ("rac", "wac")
                    for field in DEMOGRAPHIC_FIELDS_AVAILABLE_FROM_2009
                ]
                characteristics[unavailable_columns] = pd.NA

            characteristic_columns = [
                "year", "GEOID", "rac_jobs", "wac_jobs",
                *[
                    f"{basis}_{field}"
                    for basis in ("rac", "wac")
                    for field in LODES_CHARACTERISTIC_FIELDS
                    if field != "C000"
                ],
            ]
            characteristics = characteristics[characteristic_columns]
            if len(characteristics) != len(geoids) or characteristics["GEOID"].duplicated().any():
                raise RuntimeError(
                    f"Invalid characteristics block-group row count or duplicate GEOIDs for {year}"
                )

            # Ensure the extended export agrees with already-published total jobs.
            if totals_complete and not rebuild_existing:
                previous = pd.read_csv(csv_path, dtype={"GEOID": "string"})
                for column in ("rac_jobs", "wac_jobs"):
                    comparison = characteristics[["GEOID", column]].merge(
                        previous[["GEOID", column]], on="GEOID", how="outer",
                        suffixes=("_new", "_existing"), validate="one_to_one",
                    )
                    both = comparison[f"{column}_new"].notna() & comparison[f"{column}_existing"].notna()
                    if not comparison.loc[both, f"{column}_new"].eq(
                        comparison.loc[both, f"{column}_existing"]
                    ).all():
                        raise RuntimeError(
                            f"LODES characteristic {column} totals do not match the existing "
                            f"published {year} output"
                        )

            if not characteristics_complete or rebuild_existing:
                characteristics.to_csv(characteristics_path, index=False)
                characteristics_summary = {
                    "year": year,
                    "county": "Flathead County, Montana",
                    "source": "U.S. Census Bureau LEHD LODES 8",
                    "source_urls": {"rac": rac_url, "wac": wac_url},
                    "source_sha256": {"rac": self._sha256(rac_path), "wac": self._sha256(wac_path)},
                    "output": str(characteristics_path.relative_to(self.root)),
                    "block_groups": int(len(characteristics)),
                    "characteristic_fields": list(LODES_CHARACTERISTIC_FIELDS),
                    "dimensions": {
                        "industry": list(INDUSTRY_FIELDS), "earnings": list(EARNINGS_FIELDS),
                        "age": list(AGE_FIELDS), "race": list(RACE_FIELDS),
                        "ethnicity": list(ETHNICITY_FIELDS), "education": list(EDUCATION_FIELDS),
                        "sex": list(SEX_FIELDS),
                    },
                    "availability": {
                        "industry_earnings_age": "2002 onward where official LODES year is available",
                        "race_ethnicity_education_sex": "2009 onward; earlier years are null/unavailable",
                        "education_universe": "workers age 30 and older",
                    },
                    "rac_block_groups_with_data": int(characteristics["rac_jobs"].notna().sum()),
                    "wac_block_groups_with_data": int(characteristics["wac_jobs"].notna().sum()),
                    "notes": [
                        "Each characteristic count is aggregated from Census blocks to 12-digit block-group GEOIDs.",
                        "RAC assigns jobs by worker residence; WAC assigns jobs by workplace.",
                        "Missing block-group matches remain null and are not converted to zero.",
                        "Race, ethnicity, education, and sex fields are null before 2009 because these characteristics were not published for those years.",
                        "The original total-jobs CSV is preserved during routine runs.",
                    ],
                }
                characteristics_summary_path.write_text(
                    json.dumps(characteristics_summary, indent=2), encoding="utf-8"
                )
                created_characteristics.append(year)

            release = releases.setdefault(str(year), {})
            release.update({
                "rac_url": rac_url, "wac_url": wac_url,
                "rac_sha256": self._sha256(rac_path), "wac_sha256": self._sha256(wac_path),
                "output": str(csv_path.relative_to(self.root)),
                "characteristics_output": str(characteristics_path.relative_to(self.root)),
                "block_groups": int(len(geoids)),
            })
            print(f"Processed LODES totals and characteristics for {year}")

        manifest = {
            "source": "U.S. Census Bureau LEHD LODES 8",
            "state": "Montana",
            "county": "Flathead County",
            "selection": "S000/JT00, total jobs plus worker/job characteristic counts",
            "available_years": years,
            "characteristic_fields": list(LODES_CHARACTERISTIC_FIELDS),
            "characteristic_availability": {
                "industry_earnings_age": "2002 onward where official LODES year is available",
                "race_ethnicity_education_sex": "2009 onward; earlier years are null/unavailable",
            },
            "releases": releases,
            "routine_overwrite_policy": "Never overwrite a complete annual output; explicit --rebuild-existing required.",
        }
        manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        result = {
            "status": "complete", "available_years": years, "created_years": created,
            "created_characteristics_years": created_characteristics,
            "skipped_existing_years": skipped,
            "manifest": str(manifest_path.relative_to(self.root)),
        }
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

from __future__ import annotations
import csv, hashlib, json, os, re, zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
import pandas as pd
import geopandas as gpd
import requests
import yaml

ROOT = Path(__file__).resolve().parents[1]

class Pipeline:
    def __init__(self, config_path: Path):
        self.config_path = config_path
        self.cfg = yaml.safe_load(config_path.read_text())
        self.root = config_path.parent.parent
        self.raw = self.root / "raw"
        self.data = self.root / "data"
        self.meta = self.root / "metadata"
        for p in (self.raw, self.data, self.meta): p.mkdir(parents=True, exist_ok=True)

    def _get(self, url, params=None):
        r = requests.get(url, params=params, timeout=120)
        r.raise_for_status()
        return r

    def _hash(self, path):
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""): h.update(chunk)
        return h.hexdigest()

    
    def discover(self):
        """Discover the latest available ACS 5-year vintage."""
        api = "https://api.census.gov/data.json"
        catalog = self._get(api).json()

        years = []

        for ds in catalog.get("dataset", []):
            # Census catalog entries can identify datasets through
            # c_dataset/c_vintage rather than an identifier URL.
            datasets = ds.get("c_dataset", [])
            if isinstance(datasets, str):
                datasets = [datasets]

            is_acs5 = (
                "acs" in datasets
                and "acs5" in datasets
                and "pums" not in datasets
            )

            if is_acs5:
                vintage = ds.get("c_vintage")
                if vintage is not None:
                    try:
                        years.append(int(vintage))
                    except (TypeError, ValueError):
                        pass

            # Fallback for catalog entries that expose the vintage in a URL.
            if not is_acs5:
                identifier = ds.get("identifier", "")
                match = re.search(
                    r"/data/(20\d{2})/acs/acs5(?:/|$)",
                    identifier
                )
                if match:
                    years.append(int(match.group(1)))

        # Confirm the candidate endpoint exists before selecting it.
        acs_year = None
        for year in sorted(set(years), reverse=True):
            try:
                self._get(
                    f"https://api.census.gov/data/{year}/acs/acs5/variables.json"
                )
                acs_year = year
                break
            except requests.RequestException:
                continue

        if acs_year is None:
            raise RuntimeError(
                "Could not identify an available ACS 5-year vintage "
                "from the Census API catalog."
            )

        out = {
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "acs_latest_detected": acs_year,
            "lodes_policy": "discover official release; do not scrape OnTheMap",
            "configured_lodes": self.cfg["vintages"]["lodes"],
            "official_sources": {
                "acs": self.cfg["acs"]["api_base"],
                "led_extract": self.cfg["lodes"]["extraction_tool"],
                "flathead_parcels": self.cfg["flathead_gis"]["parcel_feature_service"],
                "schools": self.cfg["schools"]["download_url"],
            },
        }

        print(json.dumps(out, indent=2))
        return out


    
    def fetch(self):
        """Download ACS estimates in batches, then fetch supporting source files."""
        disc = self.discover()
        year = disc["acs_latest_detected"]
        if not year:
            raise RuntimeError("Could not discover an ACS 5-year vintage")

        api = f"{self.cfg['acs']['api_base']}/{year}/acs/acs5"
        tables = self.cfg["acs"]["tables"]
        groups = list(dict.fromkeys(tables.values()))

        key = os.getenv("CENSUS_API_KEY")
        if not key:
            raise RuntimeError(
                "CENSUS_API_KEY is required for Census API requests"
            )

        # Census API requests are limited to 50 requested variables.
        # Fetch estimate variables in batches of 40, plus NAME.
        geo_cols = ["state", "county", "tract", "block group"]
        merged = {}
        all_variables = []

        for group in groups:
            print(f"Fetching ACS variable definitions: {group}")

            group_url = f"{api}/groups/{group}.json"
            group_data = self._get(group_url).json()
            variable_metadata = group_data.get("variables", {})

            variables = sorted(
                name
                for name in variable_metadata
                if name.startswith(f"{group}_") and name.endswith("E")
            )

            if not variables:
                raise RuntimeError(
                    f"No ACS estimate variables found for group {group}"
                )

            all_variables.extend(variables)

            for start in range(0, len(variables), 40):
                batch = variables[start:start + 40]
                print(
                    f"  Requesting {group}: "
                    f"{start + 1}-{start + len(batch)} "
                    f"of {len(variables)} variables"
                )

                params = {
                    "get": ",".join(["NAME"] + batch),
                    "for": "block group:*",
                    "in": (
                        f"state:{self.cfg['project']['state_fips']} "
                        f"county:{self.cfg['project']['county_fips']}"
                    ),
                    "key": key,
                }

                response = self._get(api, params)
                result = response.json()

                if len(result) < 2:
                    raise RuntimeError(
                        f"ACS returned no block-group rows for {group}"
                    )

                headers = result[0]
                positions = {
                    name: index for index, name in enumerate(headers)
                }

                missing_geo = [
                    name for name in geo_cols if name not in positions
                ]
                if missing_geo:
                    raise RuntimeError(
                        f"ACS response missing geography columns: "
                        f"{missing_geo}"
                    )

                for values in result[1:]:
                    geoid = tuple(
                        values[positions[col]] for col in geo_cols
                    )

                    if geoid not in merged:
                        merged[geoid] = {
                            col: values[positions[col]]
                            for col in geo_cols
                        }
                        merged[geoid]["NAME"] = values[
                            positions["NAME"]
                        ]

                    row = merged[geoid]
                    for variable in batch:
                        row[variable] = values[
                            positions[variable]
                        ]

        # Save one combined ACS file in standard Census JSON-array format.
        all_variables = list(dict.fromkeys(all_variables))
        output_columns = ["NAME"] + all_variables + geo_cols

        output_rows = [
            [row.get(col, "") for col in output_columns]
            for _, row in sorted(merged.items())
        ]

        out = (
            self.raw
            / "acs"
            / f"acs5_{year}_flathead_block_groups.json"
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps(
                [output_columns] + output_rows,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        print(
            f"Saved {len(output_rows)} block groups and "
            f"{len(all_variables)} ACS estimate variables to {out}"
        )

        # Save source-published county-level ACS estimates.
        # These are retrieved directly from the Census API, not calculated
        # by aggregating block-group estimates.
        county_merged = {}

        county_geo_cols = ["state", "county"]
        for start in range(0, len(all_variables), 40):
            batch = all_variables[start:start + 40]
            print(
                f"  Requesting county ACS variables "
                f"{start + 1}-{start + len(batch)} "
                f"of {len(all_variables)}"
            )

            params = {
                "get": ",".join(["NAME"] + batch),
                "for": f"county:{self.cfg['project']['county_fips']}",
                "in": f"state:{self.cfg['project']['state_fips']}",
                "key": key,
            }

            result = self._get(api, params).json()
            if len(result) != 2:
                raise RuntimeError(
                    "Expected exactly one county-level ACS result row; "
                    f"received {max(0, len(result) - 1)}."
                )

            headers = result[0]
            values = result[1]
            positions = {name: index for index, name in enumerate(headers)}

            required_cols = ["NAME"] + batch + county_geo_cols
            missing = [col for col in required_cols if col not in positions]
            if missing:
                raise RuntimeError(
                    f"County ACS response is missing columns: {missing}"
                )

            state_value = values[positions["state"]].zfill(2)
            county_value = values[positions["county"]].zfill(3)

            if (
                state_value != self.cfg["project"]["state_fips"].zfill(2)
                or county_value != self.cfg["project"]["county_fips"].zfill(3)
            ):
                raise RuntimeError(
                    "County ACS response returned unexpected state/county FIPS: "
                    f"{state_value}/{county_value}"
                )

            if not county_merged:
                county_merged = {
                    "NAME": values[positions["NAME"]],
                    "state": state_value,
                    "county": county_value,
                }

            for variable in batch:
                county_merged[variable] = values[positions[variable]]

        county_columns = ["NAME"] + all_variables + county_geo_cols
        county_row = [county_merged.get(col, "") for col in county_columns]

        county_out = (
            self.raw
            / "acs"
            / f"acs5_{year}_flathead_county.json"
        )
        county_out.parent.mkdir(parents=True, exist_ok=True)
        county_out.write_text(
            json.dumps(
                [county_columns, county_row],
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )

        print(
            f"Saved source-published county ACS estimates "
            f"({year}) to {county_out}"
        )

        # Download official TIGER/Line block-group boundaries.
        tiger = self.cfg["census_geography"][
            "county_block_groups_url"
        ]
        zpath = self.raw / "census" / Path(tiger).name
        zpath.parent.mkdir(parents=True, exist_ok=True)
        zpath.write_bytes(self._get(tiger).content)

        # Download Montana Schools source ZIP.
        school = self.cfg["schools"]["download_url"]
        spath = self.raw / "schools" / Path(school).name
        spath.parent.mkdir(parents=True, exist_ok=True)
        spath.write_bytes(self._get(school).content)

        # Save Flathead County parcel-service metadata.
        parcel_url = self.cfg["flathead_gis"][
            "parcel_feature_service"
        ]
        parcel_meta = self._get(
            parcel_url, {"f": "json"}
        ).json()

        pmeta = self.raw / "flathead_gis" / "parcel_service.json"
        pmeta.parent.mkdir(parents=True, exist_ok=True)
        pmeta.write_text(
            json.dumps(parcel_meta, indent=2),
            encoding="utf-8",
        )

        self._write_manifest()
        print("Fetch completed.")


    def _write_manifest(self):
        files=[]
        for p in self.raw.rglob("*"):
            if p.is_file(): files.append({"path":str(p.relative_to(self.root)),"sha256":self._hash(p),"bytes":p.stat().st_size})
        manifest={"build_timestamp":datetime.now(timezone.utc).isoformat(),"config":str(self.config_path.relative_to(self.root)),"files":files}
        (self.meta/"metadata.json").write_text(json.dumps(manifest, indent=2))

    def validate(self):
        errors = []
        warnings = []
        checks = {}

        import json

        acs_dir = self.raw / "acs"
        bg_files = sorted(
            acs_dir.glob("acs5_*_flathead_block_groups.json")
        )
        county_files = sorted(
            acs_dir.glob("acs5_*_flathead_county.json")
        )

        if len(bg_files) != 1:
            errors.append(
                f"Expected exactly one block-group ACS file; found {len(bg_files)}"
            )

        if len(county_files) != 1:
            errors.append(
                f"Expected exactly one county ACS file; found {len(county_files)}"
            )

        if len(bg_files) == 1 and len(county_files) == 1:
            bg_path = bg_files[0]
            county_path = county_files[0]

            bg_year = bg_path.name.split("_")[1]
            county_year = county_path.name.split("_")[1]
            checks["acs_vintage"] = {
                "block_groups": bg_year,
                "county": county_year,
                "match": bg_year == county_year,
            }

            if bg_year != county_year:
                errors.append(
                    f"ACS vintage mismatch: block groups={bg_year}, county={county_year}"
                )

            try:
                bg_data = json.loads(bg_path.read_text(encoding="utf-8"))
                county_data = json.loads(
                    county_path.read_text(encoding="utf-8")
                )

                if not bg_data or not county_data:
                    raise ValueError("ACS JSON is empty")

                bg_header, *bg_rows = bg_data
                county_header, *county_rows = county_data

                bg_geo = {
                    "NAME", "state", "county", "tract", "block group"
                }
                county_geo = {"NAME", "state", "county"}

                bg_vars = set(bg_header) - bg_geo
                county_vars = set(county_header) - county_geo

                checks["acs_variables"] = {
                    "block_group_count": len(bg_vars),
                    "county_count": len(county_vars),
                    "match": bg_vars == county_vars,
                }

                if bg_vars != county_vars:
                    errors.append(
                        "County and block-group ACS variable sets do not match"
                    )

                checks["acs_rows"] = {
                    "block_groups": len(bg_rows),
                    "county": len(county_rows),
                }

                if not bg_rows:
                    errors.append("Block-group ACS file contains no data rows")

                if len(county_rows) != 1:
                    errors.append(
                        f"Expected one county ACS row; found {len(county_rows)}"
                    )

                if len(county_rows) == 1:
                    row = dict(zip(county_header, county_rows[0]))
                    state = str(row.get("state", "")).zfill(2)
                    county = str(row.get("county", "")).zfill(3)
                    expected_state = str(
                        self.cfg["project"]["state_fips"]
                    ).zfill(2)
                    expected_county = str(
                        self.cfg["project"]["county_fips"]
                    ).zfill(3)

                    checks["acs_county_identity"] = {
                        "name": row.get("NAME"),
                        "state_fips": state,
                        "county_fips": county,
                        "valid": (
                            state == expected_state
                            and county == expected_county
                        ),
                    }

                    if state != expected_state or county != expected_county:
                        errors.append(
                            "County ACS file has unexpected state/county FIPS: "
                            f"{state}/{county}"
                        )

                    if not str(row.get("NAME", "")).startswith(
                        self.cfg["project"]["county_name"]
                    ):
                        errors.append(
                            "County ACS NAME does not match configured county name"
                        )

                checks["acs_files"] = {
                    "block_groups": str(bg_path.relative_to(self.root)),
                    "county": str(county_path.relative_to(self.root)),
                }

            except (OSError, ValueError, TypeError, KeyError) as exc:
                errors.append(f"Could not validate ACS files: {exc}")

        school = list((self.raw / "schools").glob("*.zip"))
        if not school:
            warnings.append("Montana Schools download not present")

        lodes = [
            p for p in (self.raw / "lodes").glob("*.csv")
            if not p.name.endswith(".bak")
        ]
        if self.cfg["lodes"]["detailed_extract_required"] and not lodes:
            warnings.append(
                "No official LED Extraction Tool LODES CSV found under raw/lodes; "
                "RAC/WAC detailed build cannot complete"
            )

        report = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "errors": errors,
            "warnings": warnings,
            "checks": checks,
            "status": (
                "failed" if errors
                else "passed_with_warnings" if warnings
                else "passed"
            ),
        }

        (self.meta / "validation_report.json").write_text(
            json.dumps(report, indent=2),
            encoding="utf-8",
        )

        if errors:
            raise RuntimeError(
                "Validation failed: " + "; ".join(errors)
            )

        print(json.dumps(report, indent=2))

    def build(self):
        """Build 2023 Flathead County block-group employment outputs."""
        import json
        import zipfile
        import geopandas as gpd

        year = 2023
        self.validate()

        # Export source-published county ACS estimates as a standalone CSV.
        county_acs_files = sorted(
            (self.raw / "acs").glob("acs5_*_flathead_county.json")
        )
        if not county_acs_files:
            raise FileNotFoundError(
                "No county-level ACS JSON found under raw/acs/."
            )

        county_acs_path = county_acs_files[-1]
        county_acs_raw = json.loads(
            county_acs_path.read_text(encoding="utf-8")
        )
        if len(county_acs_raw) != 2:
            raise RuntimeError(
                f"Expected one county row in {county_acs_path.name}."
            )

        county_acs_df = pd.DataFrame(
            county_acs_raw[1:],
            columns=county_acs_raw[0],
        )
        county_acs_out_dir = self.data / "county"
        county_acs_out_dir.mkdir(parents=True, exist_ok=True)
        county_acs_csv = (
            county_acs_out_dir
            / county_acs_path.name.replace(".json", ".csv")
        )
        county_acs_df.to_csv(county_acs_csv, index=False)
        print(f"Saved county ACS CSV to {county_acs_csv}")

        lodes_dir = self.raw / "lodes"
        rac_files = [
            p for p in lodes_dir.glob("rac_*.csv")
            if not p.name.endswith(".bak")
        ]
        wac_files = [
            p for p in lodes_dir.glob("wac_*.csv")
            if not p.name.endswith(".bak")
        ]

        if len(rac_files) != 1 or len(wac_files) != 1:
            raise RuntimeError(
                "Expected exactly one RAC CSV and one WAC CSV under raw/lodes/. "
                f"Found RAC={len(rac_files)}, WAC={len(wac_files)}."
            )

        # Load the TIGER block-group boundaries.
        tiger_files = sorted((self.raw / "census").glob("*_bg.zip"))
        if not tiger_files:
            raise FileNotFoundError(
                "No TIGER block-group ZIP found under raw/census/."
            )

        with zipfile.ZipFile(tiger_files[0]) as z:
            shp_names = [
                n for n in z.namelist()
                if n.lower().endswith(".shp")
            ]
            if len(shp_names) != 1:
                raise RuntimeError(
                    f"Expected one shapefile in {tiger_files[0].name}; "
                    f"found {len(shp_names)}."
                )

        boundaries = gpd.read_file(
            f"zip://{tiger_files[0].resolve()}!{shp_names[0]}"
        )

        required_geo_cols = {"GEOID", "STATEFP", "COUNTYFP"}
        missing_geo = required_geo_cols - set(boundaries.columns)
        if missing_geo:
            raise RuntimeError(
                f"TIGER boundaries are missing required fields: "
                f"{sorted(missing_geo)}"
            )

        boundaries["GEOID"] = boundaries["GEOID"].astype(str).str.zfill(12)
        county = boundaries[
            (boundaries["STATEFP"].astype(str).str.zfill(2) == "30")
            & (boundaries["COUNTYFP"].astype(str).str.zfill(3) == "029")
        ].copy()

        if county.empty:
            raise RuntimeError(
                "No Flathead County block groups found in the TIGER file."
            )
        if county["GEOID"].duplicated().any():
            raise RuntimeError("Duplicate block-group GEOIDs in TIGER boundaries.")

        # Load and validate the 2023 LODES rows, aggregating block records
        # to block groups using the first 12 digits of each 15-digit GEOID.
        def aggregate_lodes(path, geo_col, prefix):
            header = pd.read_csv(path, nrows=0).columns.tolist()
            required = {geo_col, "year", "C000"}
            missing = required - set(header)
            if missing:
                raise RuntimeError(
                    f"{path.name} is missing required columns: {sorted(missing)}"
                )

            frames = []
            for chunk in pd.read_csv(
                path,
                usecols=[geo_col, "year", "C000"],
                dtype={geo_col: "string"},
                chunksize=200_000,
            ):
                chunk = chunk[chunk["year"] == year].copy()
                if chunk.empty:
                    continue

                chunk[geo_col] = chunk[geo_col].str.zfill(15)
                if not chunk[geo_col].str.fullmatch(r"30\d{13}").all():
                    raise RuntimeError(
                        f"Unexpected Census block GEOID in {path.name}."
                    )

                chunk["GEOID"] = chunk[geo_col].str[:12]
                chunk["C000"] = pd.to_numeric(chunk["C000"], errors="raise")
                frames.append(chunk[["GEOID", "C000"]])

            if not frames:
                raise RuntimeError(
                    f"No {year} records found in {path.name}."
                )

            rows = pd.concat(frames, ignore_index=True)
            result = rows.groupby("GEOID", as_index=False)["C000"].sum()
            result = result.rename(columns={"C000": f"{prefix}_jobs"})
            return result

        rac = aggregate_lodes(rac_files[0], "h_geocode", "rac")
        wac = aggregate_lodes(wac_files[0], "w_geocode", "wac")

        # Load the matching ACS raw extract.
        acs_files = sorted(
            (self.raw / "acs").glob(f"acs5_*_flathead_block_groups.json")
        )
        if not acs_files:
            raise FileNotFoundError("No ACS block-group JSON found under raw/acs/.")

        acs_path = acs_files[-1]
        acs_raw = json.loads(acs_path.read_text(encoding="utf-8"))
        if len(acs_raw) < 2:
            raise RuntimeError(f"ACS extract is empty: {acs_path.name}")

        acs = pd.DataFrame(acs_raw[1:], columns=acs_raw[0])
        acs_id_cols = ["state", "county", "tract", "block group"]
        missing_ids = set(acs_id_cols) - set(acs.columns)
        if missing_ids:
            raise RuntimeError(
                f"ACS extract is missing geographic fields: {sorted(missing_ids)}"
            )

        acs["GEOID"] = (
            acs["state"].astype(str).str.zfill(2)
            + acs["county"].astype(str).str.zfill(3)
            + acs["tract"].astype(str).str.zfill(6)
            + acs["block group"].astype(str).str.zfill(1)
        )
        acs = acs.drop(columns=acs_id_cols, errors="ignore")

        if acs["GEOID"].duplicated().any():
            raise RuntimeError("Duplicate GEOIDs in ACS extract.")

        # Join data onto the TIGER polygons.
        result = county.merge(acs, on="GEOID", how="left", validate="one_to_one")
        result = result.merge(rac, on="GEOID", how="left", validate="one_to_one")
        result = result.merge(wac, on="GEOID", how="left", validate="one_to_one")

        if result.empty:
            raise RuntimeError("Spatial output unexpectedly contains no block groups.")

        # Missing LODES matches are not automatically zero: preserve as null
        # and report their coverage so users can distinguish missing from zero.
        summary = {
            "build_year": year,
            "county": "Flathead County, Montana",
            "block_groups": int(len(result)),
            "rac_block_groups_with_data": int(result["rac_jobs"].notna().sum()),
            "wac_block_groups_with_data": int(result["wac_jobs"].notna().sum()),
            "rac_2023_total_from_source": int(rac["rac_jobs"].sum()),
            "wac_2023_total_from_source": int(wac["wac_jobs"].sum()),
            "acs_source": acs_path.name,
            "acs_vintage": acs_path.name.split("_")[1],
            "acs_county_source": (
                sorted(
                    (self.raw / "acs").glob(
                        "acs5_*_flathead_county.json"
                    )
                )[-1].name
            ),
            "acs_county_source_type": "Census API county-level ACS 5-year estimates",
            "acs_county_geography": "Flathead County, Montana",
            "acs_county_variable_count": len(
                json.loads(
                    sorted(
                        (self.raw / "acs").glob(
                            "acs5_*_flathead_county.json"
                        )
                    )[-1].read_text(encoding="utf-8")
                )[0]
            ) - 3,
            "tiger_source": tiger_files[0].name,
            "rac_source": rac_files[0].name,
            "wac_source": wac_files[0].name,
            "notes": [
                "LODES source totals are aggregated from census blocks to block groups.",
                "RAC represents jobs by worker residence; WAC represents jobs by workplace.",
                "Null LODES values indicate no matched source record, not necessarily zero.",
                "ACS values retain their source variable names and units.",
            ],
        }

        out_dir = self.data / str(year)
        out_dir.mkdir(parents=True, exist_ok=True)

        # Save tabular and geospatial formats.
        csv_path = out_dir / "flathead_block_groups_2023.csv"
        gpkg_path = out_dir / "flathead_economic_2023.gpkg"
        geojson_path = out_dir / "flathead_economic_2023.geojson"

        result.drop(columns="geometry").to_csv(csv_path, index=False)
        result.to_file(gpkg_path, layer="block_groups", driver="GPKG")
        result.to_crs("EPSG:4326").to_file(
            geojson_path, driver="GeoJSON"
        )

        summary_path = out_dir / "build_summary.json"
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

        dictionary = pd.DataFrame([
            {"field": "GEOID", "description": "12-digit Census block-group identifier", "source": "TIGER/Line"},
            {"field": "rac_jobs", "description": "LODES C000 total jobs by worker residence, aggregated to block group", "source": rac_files[0].name},
            {"field": "wac_jobs", "description": "LODES C000 total jobs by workplace, aggregated to block group", "source": wac_files[0].name},
        ])
        dictionary_path = self.meta / "build_data_dictionary.csv"
        dictionary.to_csv(dictionary_path, index=False)

        # Record hashes of source and generated files in the metadata manifest.
        self._write_manifest()

        print(json.dumps({
            "status": "built",
            "year": year,
            "outputs": [
                str(csv_path),
                str(gpkg_path),
                str(geojson_path),
                str(summary_path),
                str(dictionary_path),
            ],
            "summary": summary,
        }, indent=2))


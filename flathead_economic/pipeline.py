from __future__ import annotations
import csv, hashlib, json, os, re, zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
import pandas as pd
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
        errors=[]; warnings=[]
        acs_files=list((self.raw/"acs").glob("*.json"))
        if not acs_files: errors.append("No ACS raw extract found")
        school=list((self.raw/"schools").glob("*.zip"))
        if not school: warnings.append("Montana Schools download not present")
        lodes=list((self.raw/"lodes").glob("*.csv"))
        if self.cfg["lodes"]["detailed_extract_required"] and not lodes:
            warnings.append("No official LED Extraction Tool LODES CSV found under raw/lodes; RAC/WAC detailed build cannot complete")
        report={"timestamp":datetime.now(timezone.utc).isoformat(),"errors":errors,"warnings":warnings,"status":"failed" if errors else "passed_with_warnings" if warnings else "passed"}
        (self.meta/"validation_report.json").write_text(json.dumps(report, indent=2))
        if errors: raise RuntimeError("Validation failed: " + "; ".join(errors))
        print(json.dumps(report, indent=2))

    def build(self):
        self.fetch()
        self.validate()
        # The full spatial materialization is intentionally gated on validated detailed LODES input.
        # This prevents a partial build from masquerading as the authoritative dataset.
        if not list((self.raw/"lodes").glob("*.csv")):
            raise RuntimeError("Build stopped: detailed LODES extract is required. Export the required RAC/WAC characteristics from the official LED Extraction Tool into raw/lodes/ and rerun build.")
        raise NotImplementedError("Spatial materialization stage is scaffolded but not enabled until the exact LED Extraction Tool export schema is validated against the current source release.")

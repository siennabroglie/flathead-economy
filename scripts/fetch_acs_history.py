"""Fetch historical ACS 5-year estimates for Flathead County.

Creates compact block-group and county CSVs for each available vintage
(2009–2024). Fields absent from an older vintage are written as blank.
"""
from __future__ import annotations

import csv
import json
import os
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "acs"
RAW = ROOT / "raw" / "acs" / "history"
API = "https://api.census.gov/data"
STATE = "30"
COUNTY = "029"
YEARS = range(2009, 2025)
FIELDS = [
    "B01001_001E", "B01001_003E", "B01001_020E", "B01001_027E",
    "B01001_044E", "B19013_001E", "B19025_001E", "B11001_001E",
    "B11001_002E", "B11001_007E", "B19301_001E", "B17001_002E",
    "B15003_017E", "B15003_018E", "B15003_019E", "B15003_020E",
    "B15003_021E", "B15003_022E", "B15003_023E", "B15003_024E",
    "B23025_003E", "B23025_004E", "B23025_005E",
]
GEO_FIELDS = ["state", "county", "tract", "block group"]
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "FlatheadEconomicData/1.0"})
KEY = os.environ.get("CENSUS_API_KEY")
if not KEY:
    raise SystemExit("CENSUS_API_KEY is required")


def available_fields(year: int) -> list[str]:
    url = f"{API}/{year}/acs/acs5/variables.json"
    response = SESSION.get(url, timeout=90)
    response.raise_for_status()
    catalog = response.json().get("variables", {})
    available = [field for field in FIELDS if field in catalog]
    if not available:
        raise RuntimeError(f"ACS {year}: none of the requested map variables exist")
    missing = sorted(set(FIELDS) - set(available))
    if missing:
        print(f"ACS {year}: {len(missing)} selected map fields are not published in this vintage")
    return available


def fetch(year: int, geography: str, fields: list[str]) -> list[list[str]]:
    url = f"{API}/{year}/acs/acs5"
    params = {"get": ",".join(["NAME", *fields]), "key": KEY}
    if geography == "block group":
        params.update({
            "for": "block group:*",
            "in": f"state:{STATE} county:{COUNTY} tract:*",
        })
    else:
        params.update({"for": f"county:{COUNTY}", "in": f"state:{STATE}"})
    response = SESSION.get(url, params=params, timeout=90)
    if not response.ok:
        raise RuntimeError(
            f"ACS {year} {geography} request failed ({response.status_code}): "
            f"{response.text[:1000]}"
        )
    payload = response.json()
    if not isinstance(payload, list) or len(payload) < 2:
        raise RuntimeError(f"Unexpected Census response for {year} {geography}: {payload}")
    header = payload[0]
    required = ["NAME", *fields, *(GEO_FIELDS if geography == "block group" else ["state", "county"])]
    missing = sorted(set(required) - set(header))
    if missing:
        raise RuntimeError(f"{year} {geography} missing columns: {missing}")
    return payload


def write_csv(path: Path, payload: list[list[str]], geography: str, fields: list[str]) -> None:
    header, *rows = payload
    positions = {name: i for i, name in enumerate(header)}
    if geography == "block group":
        columns = ["GEOID", "NAME", *FIELDS]
        with path.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=columns)
            writer.writeheader()
            for row in rows:
                geoid = (
                    row[positions["state"]].zfill(2)
                    + row[positions["county"]].zfill(3)
                    + row[positions["tract"]].zfill(6)
                    + row[positions["block group"]].zfill(1)
                )
                writer.writerow({
                    "GEOID": geoid,
                    "NAME": row[positions["NAME"]],
                    **{name: row[positions[name]] if name in positions else "" for name in FIELDS},
                })
    else:
        columns = ["NAME", *FIELDS, "state", "county"]
        if len(rows) != 1:
            raise RuntimeError(f"Expected one Flathead County row, got {len(rows)}")
        writer_row = {
            name: rows[0][positions[name]] if name in positions else ""
            for name in columns
        }
        if writer_row["state"].zfill(2) != STATE or writer_row["county"].zfill(3) != COUNTY:
            raise RuntimeError(f"ACS county response has unexpected FIPS for {path.name}")
        with path.open("w", newline="", encoding="utf-8") as stream:
            writer = csv.DictWriter(stream, fieldnames=columns)
            writer.writeheader()
            writer.writerow(writer_row)


def main() -> None:
    print("Backfilling ACS five-year vintages 2009–2024 for Flathead County")
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    for year in YEARS:
        print(f"Fetching ACS {year} five-year estimates")
        fields = available_fields(year)
        bg = fetch(year, "block group", fields)
        county = fetch(year, "county", fields)
        if len(bg) < 2:
            raise RuntimeError(f"ACS {year}: Census returned no block-group rows")
        bg_header = bg[0]
        bg_positions = {name: i for i, name in enumerate(bg_header)}
        if any(row[bg_positions["state"]] != STATE or row[bg_positions["county"]] != COUNTY for row in bg[1:]):
            raise RuntimeError(f"ACS {year}: response contains a row outside Flathead County")
        for geography, payload in (("block_groups", bg), ("county", county)):
            raw_path = RAW / f"acs5_{year}_flathead_{geography}.json"
            raw_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        write_csv(OUT / f"acs5_{year}_flathead_block_groups.csv", bg, "block group", fields)
        write_csv(OUT / f"acs5_{year}_flathead_county.csv", county, "county", fields)
        print(f"Saved ACS {year}: {len(bg)-1} block groups and 1 county row; {len(fields)}/{len(FIELDS)} fields available")


if __name__ == "__main__":
    main()

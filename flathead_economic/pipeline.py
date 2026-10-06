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
        # Census ACS: identify the newest 5-year dataset advertised by the API catalog.
        api = "https://api.census.gov/data.json"
        data = self._get(api).json()
        years = []
        for ds in data.get("dataset", []):
            ident = ds.get("identifier", "")
            if "/acs/acs5" in ident:
                m = re.search(r"/data/(20\d{2})/", ident)
                if m: years.append(int(m.group(1)))
        acs_year = max(years) if years else None
        # LODES latest release is deliberately discovered from the official index page;
        # detailed extraction still goes through LED Extraction Tool/raw official export.
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
        # Discover current ACS vintage and download the required block-group tables.
        disc = self.discover()
        year = disc["acs_latest_detected"]
        if not year: raise RuntimeError("Could not discover an ACS 5-year vintage")
        api = f"{self.cfg['acs']['api_base']}/{year}/acs/acs5"
        tables = self.cfg["acs"]["tables"]
        groups = list(dict.fromkeys(tables.values()))
        # API keys are now required by Census. Keep the key out of source control.
        key = os.getenv("CENSUS_API_KEY")
        if not key: raise RuntimeError("CENSUS_API_KEY is required for Census API requests")
        get = ["NAME"] + [f"group({g})" for g in groups]
        params = {"get": ",".join(get), "for": "block group:*", "in": f"state:{self.cfg['project']['state_fips']} county:{self.cfg['project']['county_fips']}", "key": key}
        r = self._get(api, params)
        out = self.raw / "acs" / f"acs5_{year}_flathead_block_groups.json"
        out.parent.mkdir(parents=True, exist_ok=True); out.write_text(r.text)
        # Official TIGER/Line block-group geometry.
        tiger = self.cfg["census_geography"]["county_block_groups_url"]
        zpath = self.raw / "census" / Path(tiger).name
        zpath.parent.mkdir(parents=True, exist_ok=True)
        zpath.write_bytes(self._get(tiger).content)
        # Montana Schools.
        school = self.cfg["schools"]["download_url"]
        spath = self.raw / "schools" / Path(school).name
        spath.parent.mkdir(parents=True, exist_ok=True); spath.write_bytes(self._get(school).content)
        # Flathead parcel service schema; geometry download is paginated and handled separately.
        parcel_meta = self._get(self.cfg["flathead_gis"]["parcel_feature_service"], {"f":"json"}).json()
        pmeta = self.raw / "flathead_gis" / "parcel_service.json"
        pmeta.parent.mkdir(parents=True, exist_ok=True); pmeta.write_text(json.dumps(parcel_meta, indent=2))
        self._write_manifest()

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

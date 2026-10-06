"""Fail-loud schema checker for downloaded official extracts."""
from pathlib import Path
import pandas as pd
import sys

EXPECTED = {
    "S000": "total LODES jobs/workers",
}

path = Path(sys.argv[1])
df = pd.read_csv(path, nrows=5)
missing = [k for k in EXPECTED if k not in df.columns]
if missing:
    raise SystemExit(f"SCHEMA CHANGE: missing expected columns: {missing}")
print("Schema check passed:", path)

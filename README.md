# Flathead County Economic Data Pipeline

Reproducible, updateable geospatial economic dataset for Flathead County, Montana.

## What this implements

- Source-driven vintage discovery rather than hard-coded annual updates.
- 2024 ACS 5-year block-group extraction for the specified economic/demographic measures.
- LODES 8.4 / 2023 configuration for RAC and WAC.
- Explicit block-to-block-group aggregation and validation rules.
- Official Flathead County ArcGIS REST service configuration for parcel/boundary inputs.
- Montana State Library school dataset configuration.
- Machine-readable source registry and field dictionary.
- Loud schema-change failures and build manifest/validation reporting.

## Important implementation boundary

The LED Extraction Tool is intentionally not scraped. Detailed LODES education/industry extracts should be produced through the official Census LED Extraction Tool and placed under `raw/lodes/`; the pipeline validates their schema before use. This follows the specification's requirement to prefer official downloadable/API products and never scrape OnTheMap when an official extraction path exists.

## Quick start

```bash
python -m venv .venv
# activate the environment
pip install -r requirements.txt
python -m flathead_economic.cli build --config config/config.yaml
```

The first build downloads source files into `raw/`, writes staging tables, and produces the configured output package. Network access and a Census API key are required for ACS API requests.

## Commands

```text
python -m flathead_economic.cli discover
python -m flathead_economic.cli fetch --config config/config.yaml
python -m flathead_economic.cli validate --config config/config.yaml
python -m flathead_economic.cli build --config config/config.yaml
```

`discover` reports the current source registry and checks official endpoints. `fetch` retrieves raw inputs. `validate` runs source/schema checks on the available raw inputs. `build` runs fetch, transformation, validation, and output generation.

## Output contract

```text
flathead-economic/
├── data/
│   ├── flathead_economic.gpkg
│   ├── flathead_economic.geojson
│   └── flathead_economic.csv
├── metadata/
│   ├── metadata.json
│   ├── data_dictionary.csv
│   ├── source_registry.yaml
│   └── validation_report.json
└── raw/
    └── downloaded source files
```

The GeoPackage is the authoritative spatial output.


## Automated official LODES history

The separate **Update LODES Historical Data** GitHub Actions workflow reads the official Census Bureau LEHD LODES 8 Montana RAC and WAC directories and discovers years for which both files are available. It downloads the all-jobs selection (`S000/JT00`), filters the 15-digit Census block GEOIDs to Flathead County (state/county prefix `30029`), aggregates `C000` to 12-digit block groups, and creates annual CSVs.

Outputs are stored separately from the existing 2023 map products:

```text
data/lodes/
├── 2002/
│   ├── flathead_lodes_jobs_by_block_group.csv
│   └── build_summary.json
├── 2003/
└── ...
metadata/lodes_history_manifest.json
```

Each annual summary records official source URLs, SHA-256 hashes, job totals, coverage, and the build year. Routine runs never overwrite a complete annual output. The workflow can be run manually from **Actions → Update LODES Historical Data → Run workflow**. Leave `rebuild_existing` false for routine updates; set it true only when intentionally rebuilding historical years.

The same official RAC/WAC downloads also contain worker/job characteristic counts. The history updater aggregates these columns to block groups into a separate `flathead_lodes_characteristics_by_block_group.csv` file for each year, preserving the existing total-jobs CSV. The expanded output includes industry sector (20 categories), earnings (3), age (3), education (4), race (6), ethnicity (2), and sex (2), separately for residence-based RAC and workplace-based WAC. Field labels and availability rules are documented in `metadata/lodes_characteristics_dictionary.csv`.

LODES race, ethnicity, education, and sex characteristics are available from 2009 onward; for 2002–2008, those fields are stored as null rather than treating the source's placeholder zeros as observed counts. Education characteristics cover workers age 30 and older. Industry, earnings, and age characteristics are available throughout the available annual series. The pipeline checks that characteristic columns exist, validates years and nonnegative counts, preserves missing geography matches as null, and checks expanded totals against already-published totals.

The LODES history output is a standalone annual jobs table. It does not replace the existing `data/2023/` spatial products or silently merge a new LODES year with a different ACS vintage. Those steps remain separate so historical outputs and methodology stay explicit.

Official source directories:
- RAC: https://lehd.ces.census.gov/data/lodes/LODES8/mt/rac/
- WAC: https://lehd.ces.census.gov/data/lodes/LODES8/mt/wac/

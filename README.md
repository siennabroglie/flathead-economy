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

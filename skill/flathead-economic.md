# Flathead County Economic Data Pipeline Skill

## Purpose
Build and maintain a reproducible, updateable geospatial economic dataset for Flathead County, Montana.

## Operating rules
1. Prefer official federal, state, county, and Montana State Library sources.
2. Discover the newest compatible source vintage at update time; do not hard-code annual behavior into update logic.
3. Preserve source vintages, geography vintages, URLs, retrieval timestamps, and file hashes.
4. Fail loudly on schema changes. Never silently rename or remap a changed source field.
5. Use Census block group as the primary analytical geography.
6. Never average percentages when a numerator/denominator aggregation is possible.
7. Never average medians to produce larger-area medians.
8. Keep source-native values in staging/raw tables and expose calculated values separately.
9. Never scrape OnTheMap when an official LED Extraction Tool or downloadable LODES source exists.
10. Preserve the LODES age-30+ universe restriction for educational attainment.

## User-facing layer names
Use exactly: People, Residents, Workers, Jobs, County Totals, Property Development, School System.

## Update workflow
- Discover source vintages.
- Compare source schemas with stored schemas.
- Download only compatible/new inputs.
- Stop on incompatible schema changes.
- Rebuild derived outputs.
- Validate geography and aggregates.
- Write a validation report and build manifest.

## Output
The GeoPackage is authoritative; GeoJSON is for web mapping; CSV is for analysis; raw inputs are retained for auditability.

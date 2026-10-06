# Metadata notes

`data_dictionary.csv` contains the initial stable public output contract. The generated `metadata.json` records the build timestamp and raw-file hashes. `validation_report.json` records validation status.

The implementation deliberately refuses to produce a final authoritative dataset when the detailed LODES extraction schema has not been explicitly validated. This is preferable to silently treating a basic RAC/WAC file as if it contained education and detailed industry variables.

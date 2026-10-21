const GEOJSON_URL = "data/2023/flathead_economic_2023.geojson";

export const AVAILABLE_LODES_YEARS = Array.from({ length: 2023 - 2002 + 1 }, (_, i) => 2002 + i);

export async function loadBlockGroups() {
  const response = await fetch(GEOJSON_URL);
  if (!response.ok) throw new Error(`Could not load block-group geography (${response.status}).`);
  const geojson = await response.json();
  if (!geojson || !Array.isArray(geojson.features)) {
    throw new Error("The geographic file did not contain a valid GeoJSON feature collection.");
  }
  return geojson;
}

export async function loadLodesYear(year) {
  if (!AVAILABLE_LODES_YEARS.includes(Number(year))) throw new Error("That LODES year is not available.");
  const url = `data/lodes/${year}/flathead_lodes_jobs_by_block_group.csv`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load LODES data for ${year} (${response.status}).`);
  const text = await response.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error(`The ${year} LODES file is empty.`);
  const headers = lines[0].split(",");
  const positions = Object.fromEntries(headers.map((name, index) => [name.trim(), index]));
  for (const required of ["GEOID", "rac_jobs", "wac_jobs"]) {
    if (!(required in positions)) throw new Error(`The ${year} LODES file is missing the ${required} field.`);
  }
  return new Map(lines.slice(1).map(line => {
    const cells = line.split(",");
    const geoid = String(cells[positions.GEOID] ?? "").trim().replace(/^"|"$/g, "");
    const parseNumber = value => value == null || value.trim() === "" ? null : Number(value);
    return [geoid, {
      rac_jobs: parseNumber(cells[positions.rac_jobs]),
      wac_jobs: parseNumber(cells[positions.wac_jobs])
    }];
  }).filter(([geoid]) => geoid));
}

export function getFeatureGeoid(feature) {
  const properties = feature?.properties ?? {};
  const key = Object.keys(properties).find(name => name.toUpperCase() === "GEOID");
  return key ? String(properties[key]).trim() : null;
}

export function getFeatureLabel(feature) {
  const properties = feature?.properties ?? {};
  const key = Object.keys(properties).find(name => ["NAMELSAD", "NAME", "LABEL"].includes(name.toUpperCase()));
  return key ? String(properties[key]) : "Census block group";
}

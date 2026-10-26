/* Map behavior and data loading. Visual design belongs in assets/css/map.css. */
(() => {
  "use strict";

  const GEOJSON_URL = "data/2023/flathead_economic_2023.geojson";
  const LODES_PATH = (year) => "data/lodes/" + year + "/flathead_lodes_characteristics_by_block_group.csv";
  const LODES_YEARS = Array.from({ length: 22 }, (_, i) => 2023 - i);
  const ACS_FIELDS = {
    B01001_001E: { label: "Total population", format: "number" },
    B01001_003E: { label: "Male population under 5", format: "number" },
    B01001_020E: { label: "Male population age 65–66", format: "number" },
    B01001_027E: { label: "Female population under 5", format: "number" },
    B01001_044E: { label: "Female population age 65–66", format: "number" },
    B19013_001E: { label: "Median household income", format: "currency" },
    B19025_001E: { label: "Aggregate household income", format: "currency" },
    B11001_001E: { label: "Total households", format: "number" },
    B11001_002E: { label: "Family households", format: "number" },
    B11001_007E: { label: "Nonfamily households", format: "number" },
    B19301_001E: { label: "Per-capita income", format: "currency" },
    B17001_002E: { label: "Population below poverty level", format: "number" },
    B15003_017E: { label: "High school graduate", format: "number" },
    B15003_021E: { label: "Bachelor's degree", format: "number" },
    B15003_022E: { label: "Master's degree", format: "number" },
    B15003_023E: { label: "Professional school degree", format: "number" },
    B15003_024E: { label: "Doctorate degree", format: "number" },
    B23025_003E: { label: "Civilian labor force", format: "number" },
    B23025_004E: { label: "Employed population", format: "number" },
    B23025_005E: { label: "Unemployed population", format: "number" }
  };
  const LODES_META = {
    total: { label: "Total jobs", format: "number", field: "jobs" },
    industry: { label: "Industry jobs", format: "number" },
    earnings: { label: "Jobs by worker earnings", format: "number" },
    education: { label: "Jobs by worker education", format: "number" },
    age: { label: "Jobs by worker age", format: "number" },
    raceethnicity: { label: "Jobs by worker race and ethnicity", format: "number" },
    sex: { label: "Jobs by worker sex", format: "number" }
  };
  const INDUSTRY_LABELS = {
    CNS01: "Agriculture, forestry, fishing and hunting", CNS02: "Mining, quarrying, and oil and gas extraction",
    CNS03: "Utilities", CNS04: "Construction", CNS05: "Manufacturing", CNS06: "Wholesale trade",
    CNS07: "Retail trade", CNS08: "Transportation and warehousing", CNS09: "Information",
    CNS10: "Finance and insurance", CNS11: "Real estate and rental and leasing",
    CNS12: "Professional, scientific and technical services", CNS13: "Management of companies and enterprises",
    CNS14: "Administrative and support services", CNS15: "Educational services",
    CNS16: "Health care and social assistance", CNS17: "Arts, entertainment and recreation",
    CNS18: "Accommodation and food services", CNS19: "Other services", CNS20: "Public administration"
  };
  const DETAIL_LABELS = {
    CE01: "$1,250 per month or less", CE02: "$1,251–$3,333 per month", CE03: "More than $3,333 per month",
    CD01: "Less than high school", CD02: "High school or equivalent, no college",
    CD03: "Some college or associate degree", CD04: "Bachelor's degree or advanced degree",
    CA01: "Youngest age group", CA02: "Age 30–54", CA03: "Oldest age group",
    CR01: "White alone", CR02: "Black or African American alone", CR03: "American Indian or Alaska Native alone",
    CR04: "Asian alone", CR05: "Native Hawaiian or Other Pacific Islander alone", CR07: "Two or more race groups",
    CT01: "Not Hispanic or Latino", CT02: "Hispanic or Latino", CS01: "Male", CS02: "Female"
  };
  const ACS_CATEGORY_DEFAULTS = {
    population: "B01001_001E", "median-income": "B19013_001E",
    "aggregate-income": "B19025_001E", households: "B11001_002E",
    "per-capita": "B19301_001E", poverty: "B17001_002E",
    education: "B15003_021E", employment: "B23025_004E"
  };
  const ACS_CATEGORY_LABELS = {
    population: "Population & Age", "median-income": "Median household income",
    "aggregate-income": "Aggregate household income", households: "Household composition",
    "per-capita": "Per-capita income", poverty: "Poverty status",
    education: "Education level", employment: "Employment status"
  };
  const ACS_CATEGORY_FIELDS = {
    population: ["B01001_001E"],
    "median-income": ["B19013_001E"],
    "aggregate-income": ["B19025_001E"],
    households: ["B11001_002E", "B11001_007E"],
    "per-capita": ["B19301_001E"],
    poverty: ["B17001_002E"],
    education: ["B15003_017E", "B15003_021E", "B15003_022E", "B15003_023E", "B15003_024E"],
    employment: ["B23025_004E", "B23025_005E"]
  };
  const COLORS = ["#f2f3ed", "#d4e2d7", "#a9c9b3", "#76a489", "#477b61", "#24513c"];
  const els = {
    lodesYear: document.querySelector("#lodes-year"),
    lodesMeasures: document.querySelector("#lodes-measures"),
    mapMode: document.querySelector("#map-mode"),
    primaryMeasure: document.querySelector("#primary-measure"),
    basis: Array.from(document.querySelectorAll('input[name="lodes-basis"]')),
    lodesNote: document.querySelector("#lodes-availability-note"),
    acsYear: document.querySelector("#acs-year"),
    acsMeasures: document.querySelector("#acs-measures"),
    acsDetail: document.querySelector("#acs-detail"),
    acsSelectors: Array.from(document.querySelectorAll("[data-acs-selector]")),
    legendTitle: document.querySelector("#legend-title"),
    legend: document.querySelector("#legend"),
    status: document.querySelector("#map-status"),
    period: document.querySelector("#map-period")
  };

  const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([48.25, -114.25], 9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  let geojsonLayer = null;
  let baseFeatures = [];
  let selectedYearData = new Map();
  let activeMode = "jobs";
  let activeLodesCategory = "total";
  let activeAcsCategory = "population";
  let mapMode = "single";
  let compositeValues = new Map();
  let compositeError = "";
  let currentBreaks = [];

  LODES_YEARS.forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    els.lodesYear.appendChild(option);
  });
  els.lodesYear.value = "2023";

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (ch === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { row.push(cell); cell = ""; }
      else if ((ch === "\n" || ch === "\r") && !quoted) {
        if (ch === "\r" && text[i + 1] === "\n") i += 1;
        row.push(cell); cell = "";
        if (row.some((value) => value !== "")) rows.push(row);
        row = [];
      } else cell += ch;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    const headers = rows[0];
    return rows.slice(1).map((values) => Object.fromEntries(headers.map((key, i) => [key, values[i] ?? ""])));
  }

  const numeric = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const formatValue = (value, type = "number") => {
    if (value === null || value === undefined || value === "") return "No data";
    const n = Number(value);
    if (!Number.isFinite(n)) return "No data";
    if (type === "currency") return new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0
    }).format(n);
    if (type === "percent") return new Intl.NumberFormat("en-US", {
      style: "percent", maximumFractionDigits: 1
    }).format(n);
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
  };
  const selectedBasis = () => (els.basis.find((item) => item.checked) || {}).value || "rac";
  const selectedLodesCodes = (category = activeLodesCategory) => {
    const selector = document.querySelector('[data-selector="' + category + '"]');
    return selector ? Array.from(selector.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value) : [];
  };
  const DOMINANT_ORDER = {
    earnings: ["CE03", "CE02", "CE01"],
    education: ["CD04", "CD03", "CD02", "CD01"],
    age: ["CA03", "CA02", "CA01"],
    sex: ["CS01", "CS02"],
    raceethnicity: ["CR01", "CR02", "CR03", "CR04", "CR05", "CR07", "CT01", "CT02"]
  };
  function dominantCategory(feature, category = activeLodesCategory) {
    const row = selectedYearData.get(String((feature.properties || {}).GEOID ?? (feature.properties || {}).GEOIDFQ ?? ""));
    if (!row) return null;
    const selected = selectedLodesCodes(category);
    let ordered = (DOMINANT_ORDER[category] || []).filter((code) => selected.includes(code));
    if (!ordered.length) return null;
    // Race and ethnicity are distinct dimensions; map one dimension at a time.
    if (category === "raceethnicity") {
      const raceCodes = ordered.filter((code) => code.startsWith("CR"));
      const ethnicityCodes = ordered.filter((code) => code.startsWith("CT"));
      if (raceCodes.length && ethnicityCodes.length) return null;
      ordered = raceCodes.length ? raceCodes : ethnicityCodes;
    }
    const counts = ordered.map((code) => ({ code, count: numeric(row[selectedBasis() + "_" + code]) }));
    if (counts.some((item) => item.count === null)) return null;
    const selector = document.querySelector('[data-selector="' + category + '"]');
    let allCodes = selector ? Array.from(selector.querySelectorAll('input[type="checkbox"]')).map((input) => input.value) : ordered;
    if (category === "raceethnicity") {
      allCodes = allCodes.filter((code) => ordered[0].startsWith("CR") ? code.startsWith("CR") : code.startsWith("CT"));
    }
    const denominatorValues = allCodes.map((code) => numeric(row[selectedBasis() + "_" + code]));
    if (denominatorValues.some((value) => value === null)) return null;
    const denominator = denominatorValues.reduce((sum, value) => sum + value, 0);
    if (!denominator) return null;
    const winner = counts.reduce((best, item) => item.count > best.count ? item : best);
    return { ...winner, share: winner.count / denominator, rank: ordered.indexOf(winner.code), ordered };
  }
  const isDominantMode = () => mapMode === "single" && activeMode === "jobs" &&
    !["total", "industry", "raceethnicity"].includes(activeLodesCategory);
  function activeMeta() {
    if (mapMode === "combined") {
      return { label: "Combined index · equal-weight normalized score", format: "number" };
    }
    if (activeMode === "acs") {
      const fields = selectedAcsFields(activeAcsCategory);
      if (fields.length > 1) return { label: "Combined selected ACS subcategories", format: "number" };
      const field = fields[0] || "B01001_001E";
      return ACS_FIELDS[field] || { label: "ACS measure", format: "number" };
    }
    if (activeLodesCategory === "industry") {
      return { label: "Combined jobs in selected industries", format: "number" };
    }
    if (isDominantMode()) {
      return { label: "Dominant worker-category share", format: "percent", dominant: true };
    }
    if (activeMode === "jobs" && activeLodesCategory === "raceethnicity") {
      return { label: "Selected race or ethnicity share", format: "percent", dominant: true };
    }
    return LODES_META.total;
  }
  function getSingleValue(feature) {
    const p = feature.properties || {};
    if (activeMode === "acs") {
      const fields = selectedAcsFields(activeAcsCategory);
      if (!fields.length) return null;
      const values = fields.map((field) => numeric(p[field]));
      if (values.some((value) => value === null)) return null;
      return values.reduce((sum, value) => sum + value, 0);
    }
    const row = selectedYearData.get(String(p.GEOID ?? p.GEOIDFQ ?? ""));
    if (!row) return null;
    if (activeLodesCategory === "total") return numeric(row[selectedBasis() + "_jobs"]);
    if (activeLodesCategory === "industry") {
      const codes = selectedLodesCodes();
      if (!codes.length) return null;
      const values = codes.map((code) => numeric(row[selectedBasis() + "_" + code]));
      if (values.some((value) => value === null)) return null;
      return values.reduce((sum, value) => sum + value, 0);
    }
    const dominant = dominantCategory(feature);
    return dominant ? dominant.share : null;
  }
  function getValue(feature) {
    if (mapMode === "combined") {
      const p = feature.properties || {};
      return compositeValues.get(String(p.GEOID ?? p.GEOIDFQ ?? "")) ?? null;
    }
    if (!els.primaryMeasure.value) return null;
    return getSingleValue(feature);
  }
  const quantileBreaks = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    if (!sorted.length) return [];
    return [0.2, 0.4, 0.6, 0.8, 1].map((q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]);
  };
  const colorFor = (value, breaks) => {
    if (value === null || !breaks.length) return "#d8dcd8";
    const index = breaks.findIndex((limit) => value <= limit);
    return COLORS[index < 0 ? COLORS.length - 1 : index + 1];
  };
  function styleFeature(feature) {
    const fillColor = colorFor(getValue(feature), currentBreaks);
    return { fillColor, weight: 1, opacity: 1, color: "#ffffff", dashArray: "", fillOpacity: 0.82 };
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }
  function popupContent(feature) {
    const p = feature.properties || {};
    const namedGroup = String(p.NAMELSAD || p.NAME || "").match(/Block Group\s+(\d+)/i);
    const title = namedGroup ? "Block Group " + namedGroup[1] :
      (p.GEOID ? "Block Group " + String(p.GEOID).slice(-1) : "Census block group");
    const meta = activeMeta();
    const lines = [];
    if (mapMode === "combined") {
      lines.push(["Combined index score", formatValue(getValue(feature), "number")]);
      selectedMeasureKeys().forEach((key) => {
        const value = measureValueForKey(feature, key);
        lines.push([measureLabel(key), formatValue(value, key.startsWith("acs:") && ["median-income", "aggregate-income", "per-capita"].includes(key.split(":")[1]) ? "currency" : "number")]);
      });
      lines.push(["Method", "Equal-weight mean of min–max normalized measures"]);
    } else if (activeMode === "jobs") {
      const row = selectedYearData.get(String(p.GEOID || p.GEOIDFQ || ""));
      if (row) {
        if (isDominantMode()) {
          const dominant = dominantCategory(feature);
          const totalJobs = numeric(row[selectedBasis() + "_jobs"]);
          const selectedGroupTotal = selectedLodesCodes().reduce((sum, code) => {
            const value = numeric(row[selectedBasis() + "_" + code]);
            return sum + (value === null ? 0 : value);
          }, 0);
          lines.push(["Total jobs in block group", formatValue(totalJobs)]);
          lines.push(["Jobs across selected subcategories", formatValue(selectedGroupTotal)]);
          lines.push(["Dominant category", dominant ? (DETAIL_LABELS[dominant.code] || dominant.code) : "No data"]);
          lines.push([activeLodesCategory === "raceethnicity" ? "Dominant category share of all jobs" : "Dominant category share of selected subcategories", dominant ? formatValue(dominant.share, "percent") : "No data"]);
          lines.push(["Jobs in dominant category", dominant ? formatValue(dominant.count) : "No data"]);
          lines.push(["Selected subcategory counts", ""]);
          selectedLodesCodes().forEach((code) => {
            const count = numeric(row[selectedBasis() + "_" + code]);
            lines.push([DETAIL_LABELS[code] || optionLabel(code), formatValue(count)]);
          });
        } else if (activeLodesCategory === "industry") {
          const total = getValue(feature);
          lines.push(["Combined jobs in selected industries", formatValue(total)]);
          lines.push(["Total jobs in block group", formatValue(numeric(row[selectedBasis() + "_jobs"]))]);
          selectedLodesCodes().forEach((code) => {
            lines.push([optionLabel(code), formatValue(numeric(row[selectedBasis() + "_" + code]))]);
          });
        } else {
          lines.push([meta.label, formatValue(getValue(feature), meta.format)]);
          lines.push(["Total jobs in block group", formatValue(numeric(row[selectedBasis() + "_jobs"]))]);
        }
        lines.push(["Jobs by workplace", formatValue(numeric(row.wac_jobs))]);
        lines.push(["Jobs by worker residence", formatValue(numeric(row.rac_jobs))]);
      }
      lines.push(["Source", "LODES " + els.lodesYear.value]);
      if (activeLodesCategory === "education" && Number(els.lodesYear.value) < 2009) {
        lines.push(["Availability", "Not published for this year"]);
      }
    } else {
      const fields = selectedAcsFields(activeAcsCategory);
      const values = fields.map((field) => ({ field, value: numeric(p[field]) }));
      lines.push([meta.label, formatValue(getValue(feature), meta.format)]);
      if (values.length > 1) lines.push(["Selected subcategory counts", ""]);
      values.forEach(({ field, value }) => {
        const label = (ACS_FIELDS[field] || {}).label || optionLabel(field);
        lines.push([label, formatValue(value, (ACS_FIELDS[field] || {}).format || "number")]);
      });
      lines.push(["Geographic ID", p.GEOID || "Not available"]);
      lines.push(["Source", "ACS " + els.acsYear.value + " five-year estimates"]);
    }
    return '<div class="popup-card"><h3 class="popup-title">' + escapeHtml(title) + '</h3>' +
      lines.map(([label, value]) => '<div class="popup-row"><span>' + escapeHtml(label) +
        '</span><strong>' + escapeHtml(value) + '</strong></div>').join("") + '</div>';
  }
  function optionLabel(code) {
    const selector = document.querySelector('[data-selector="' + activeLodesCategory + '"]');
    const option = selector && selector.querySelector('input[type="checkbox"][value="' + code + '"]');
    if (option) return option.closest("label")?.querySelector("span")?.textContent.trim() || code;
    const acsOption = Array.from(document.querySelectorAll("[data-acs-selector] input[type=checkbox]")).find((item) => item.value === code);
    return acsOption ? (acsOption.closest("label")?.querySelector("span")?.textContent.trim() || code) : code;
  }
  function onEachFeature(feature, layer) {
    layer.bindPopup(() => popupContent(feature));
    layer.on({
      mouseover: (event) => event.target.setStyle({ weight: 2.5, color: "#1c3328", fillOpacity: 0.95 }),
      mouseout: (event) => { if (geojsonLayer) geojsonLayer.resetStyle(event.target); }
    });
  }
  function updateLegend() {
    const meta = activeMeta();
    els.legendTitle.textContent = meta.label;
    els.legend.replaceChildren();
    if (!currentBreaks.length) {
      els.legend.textContent = "No values available for this selection.";
      return;
    }
    let previous = null;
    currentBreaks.forEach((limit, i) => {
      const row = document.createElement("div");
      row.className = "legend-row";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = COLORS[i + 1];
      const range = document.createElement("span");
      range.textContent = i === 0 ? "Up to " + formatValue(limit, meta.format) :
        formatValue(previous, meta.format) + " – " + formatValue(limit, meta.format);
      const value = document.createElement("span");
      value.className = "legend-value";
      value.textContent = "Q" + (i + 1);
      row.append(swatch, range, value);
      els.legend.appendChild(row);
      previous = limit;
    });
    const missing = document.createElement("div");
    missing.className = "legend-row";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.backgroundColor = "#d8dcd8";
    const label = document.createElement("span");
    label.textContent = "No data / unmatched";
    missing.append(swatch, label, document.createElement("span"));
    els.legend.appendChild(missing);
  }
  function selectedMeasureKeys() {
    const keys = [];
    els.lodesMeasures.querySelectorAll('input[data-category]:checked').forEach((input) => {
      if (!input.disabled) keys.push("jobs:" + input.dataset.category);
    });
    els.acsMeasures.querySelectorAll('input[data-category]:checked').forEach((input) => {
      if (!input.disabled) keys.push("acs:" + input.dataset.category);
    });
    return keys;
  }
  function measureLabel(key) {
    const parts = key.split(":");
    const category = parts[1];
    if (parts[0] === "jobs") return "Employment · " + (LODES_META[category] || {}).label;
    return "Population · " + (ACS_CATEGORY_LABELS[category] || category);
  }
  function setPrimaryContext(key) {
    if (!key) return;
    const parts = key.split(":");
    activeMode = parts[0] === "acs" ? "acs" : "jobs";
    if (activeMode === "jobs") {
      activeLodesCategory = parts[1];
    } else {
      activeAcsCategory = parts[1];
      const fields = acsSelections[activeAcsCategory] || selectedAcsFields(activeAcsCategory) || ACS_CATEGORY_FIELDS[activeAcsCategory] || [];
      setAcsFields(activeAcsCategory, fields);
    }
  }
  function updatePrimaryOptions() {
    const keys = selectedMeasureKeys();
    const current = els.primaryMeasure.value || "jobs:total";
    els.primaryMeasure.replaceChildren();
    keys.forEach((key) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = measureLabel(key);
      els.primaryMeasure.appendChild(option);
    });
    if (keys.includes(current)) els.primaryMeasure.value = current;
    else if (keys.length) els.primaryMeasure.value = keys[0];
    els.primaryMeasure.disabled = keys.length === 0 || mapMode === "combined";
    setPrimaryContext(els.primaryMeasure.value);
    if (!keys.length) els.primaryMeasure.innerHTML = '<option value="">No measures selected</option>';
  }
  const acsSelections = {};
  function acsSelector(category = activeAcsCategory) {
    return document.querySelector('[data-acs-selector="' + category + '"]');
  }
  function selectedAcsFields(category = activeAcsCategory) {
    const selector = acsSelector(category);
    return selector ? Array.from(selector.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value) : [];
  }
  function setAcsFields(category, fields) {
    const selector = acsSelector(category);
    if (selector) selector.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = fields.includes(input.value); });
    acsSelections[category] = fields.slice();
    Array.from(els.acsDetail.options).forEach((option) => { option.selected = fields.includes(option.value); });
  }
  function syncActiveAcsFields() {
    const fields = selectedAcsFields(activeAcsCategory);
    acsSelections[activeAcsCategory] = fields;
    Array.from(els.acsDetail.options).forEach((option) => { option.selected = fields.includes(option.value); });
  }
  function measureValueForKey(feature, key) {
    const oldMode = activeMode;
    const oldLodes = activeLodesCategory;
    const oldAcs = activeAcsCategory;
    const oldAcsFields = selectedAcsFields(oldAcs);
    const parts = key.split(":");
    setPrimaryContext(key);
    const value = getSingleValue(feature);
    activeMode = oldMode;
    activeLodesCategory = oldLodes;
    activeAcsCategory = oldAcs;
    setAcsFields(oldAcs, oldAcsFields);
    return value;
  }
  function calculateCompositeValues() {
    compositeValues = new Map();
    compositeError = "";
    const keys = selectedMeasureKeys();
    if (!keys.length) {
      compositeError = "Select at least one measure to build a combined index.";
      return;
    }
    if (keys.some((key) => key === "jobs:raceethnicity")) {
      compositeError = "Race and ethnicity are separate dimensions and cannot be combined into one distribution. Unselect Worker Race & Ethnicity or use Single-variable mode.";
      return;
    }
    const columns = keys.map((key) => ({
      key,
      values: baseFeatures.map((feature) => measureValueForKey(feature, key))
    }));
    if (columns.some((column) => !column.values.some((value) => value !== null))) {
      compositeError = "At least one selected measure has no usable values for this year. Choose compatible measures before applying the combined index.";
      return;
    }
    const normalized = columns.map((column) => {
      const valid = column.values.filter((value) => value !== null);
      const min = Math.min(...valid);
      const max = Math.max(...valid);
      return column.values.map((value) => value === null ? null : (max === min ? 0.5 : (value - min) / (max - min)));
    });
    baseFeatures.forEach((feature, index) => {
      const values = normalized.map((column) => column[index]);
      const id = String((feature.properties || {}).GEOID ?? (feature.properties || {}).GEOIDFQ ?? "");
      compositeValues.set(id, values.some((value) => value === null) ? null :
        values.reduce((sum, value) => sum + value, 0) / values.length);
    });
  }
  function refreshMap() {
    if (!geojsonLayer) return;
    if (mapMode === "combined") calculateCompositeValues();
    else { compositeValues = new Map(); compositeError = ""; }
    currentBreaks = quantileBreaks(baseFeatures.map(getValue).filter((value) => value !== null));
    geojsonLayer.setStyle(styleFeature);
    updateLegend();
    els.period.textContent = mapMode === "combined"
      ? "Combined index · LODES " + els.lodesYear.value + " + ACS " + els.acsYear.value
      : (activeMode === "jobs" ? "LODES · " + els.lodesYear.value : "ACS · " + els.acsYear.value + " five-year");
    const selectedRaceCodes = selectedLodesCodes("raceethnicity");
    const raceEthnicityConflict = mapMode === "single" && activeMode === "jobs" &&
      activeLodesCategory === "raceethnicity" &&
      selectedRaceCodes.some((code) => code.startsWith("CR")) &&
      selectedRaceCodes.some((code) => code.startsWith("CT"));
    els.status.textContent = compositeError || (raceEthnicityConflict
      ? "Choose race OR ethnicity subcategories—not both—to map one distribution."
      : (baseFeatures.length + " block groups · " +
        baseFeatures.filter((feature) => getValue(feature) !== null).length + " with data"));
    geojsonLayer.eachLayer((layer) => {
      if (layer.isPopupOpen()) layer.setPopupContent(popupContent(layer.feature));
    });
  }
  async function loadLodesYear(year) {
    els.status.textContent = "Loading employment data for " + year + "…";
    const response = await fetch(LODES_PATH(year));
    if (!response.ok) throw new Error("Could not load LODES characteristics for " + year + " (HTTP " + response.status + ").");
    const rows = parseCsv(await response.text());
    selectedYearData = new Map(rows.map((row) => [String(row.GEOID), row]));
    const unavailable = Number(year) < 2009;
    els.lodesMeasures.querySelectorAll('[data-category="raceethnicity"], [data-category="education"], [data-category="sex"]').forEach((input) => {
      input.disabled = unavailable;
      const category = input.dataset.category;
      const selector = document.querySelector('[data-selector="' + category + '"]');
      if (selector) selector.querySelectorAll('input[type="checkbox"]').forEach((item) => { item.disabled = unavailable || !input.checked; });
      if (unavailable && input.checked) input.checked = false;
    });
    if (unavailable && ["raceethnicity", "education", "sex"].includes(activeLodesCategory)) {
      activeLodesCategory = "total";
      document.querySelector('[data-category="total"]').checked = true;
    }
    els.lodesNote.textContent = unavailable
      ? "Race, ethnicity, education and sex are unavailable before 2009; these controls are disabled for this year."
      : "Worker education describes jobs for workers age 30 and older. Age group labels reflect published LODES definitions.";
    syncLodesSelectors();
    updatePrimaryOptions();
    setPrimaryContext(els.primaryMeasure.value);
    refreshMap();
  }
  function setupBulkSelectionControls() {
    const selectors = [
      ...document.querySelectorAll("[data-selector]"),
      ...document.querySelectorAll("[data-acs-selector]")
    ];
    selectors.forEach((selector) => {
      const isAcs = selector.hasAttribute("data-acs-selector");
      const category = isAcs ? selector.dataset.acsSelector : selector.dataset.selector;
      const parent = document.querySelector('[data-category="' + category + '"]');
      if (!parent) return;
      const toolbar = document.createElement("div");
      toolbar.className = "subcategory-toolbar";
      const status = document.createElement("span");
      status.className = "subcategory-selection-status";
      status.setAttribute("aria-live", "polite");
      const allButton = document.createElement("button");
      allButton.type = "button";
      allButton.className = "subcategory-action";
      allButton.textContent = "All";
      allButton.setAttribute("aria-label", "Select all " + category + " subcategories");
      const customButton = document.createElement("button");
      customButton.type = "button";
      customButton.className = "subcategory-action";
      customButton.textContent = "Choose";
      customButton.setAttribute("aria-label", "Clear selections and choose individual " + category + " subcategories");
      toolbar.append(status, allButton, customButton);
      selector.parentNode.insertBefore(toolbar, selector);
      const items = () => Array.from(selector.querySelectorAll('input[type="checkbox"]'));
      const refreshStatus = () => {
        const checkboxes = items();
        const selected = checkboxes.filter((item) => item.checked).length;
        status.textContent = selected === checkboxes.length
          ? "All selected"
          : selected === 0
            ? "None selected"
            : selected + " selected";
        const disabled = parent.disabled;
        allButton.disabled = disabled;
        customButton.disabled = disabled;
      };
      const applySelection = (selectAll) => {
        parent.checked = true;
        items().forEach((item) => { item.checked = selectAll; });
        if (isAcs) {
          activeMode = "acs";
          activeAcsCategory = category;
          acsSelections[category] = items().filter((item) => item.checked).map((item) => item.value);
          items().forEach((item) => { item.disabled = false; });
          setAcsFields(category, acsSelections[category]);
        } else {
          activeMode = "jobs";
          activeLodesCategory = category;
          syncLodesSelectors();
        }
        updatePrimaryOptions();
        setPrimaryContext(els.primaryMeasure.value);
        refreshMap();
        refreshStatus();
      };
      allButton.addEventListener("click", () => applySelection(true));
      customButton.addEventListener("click", () => applySelection(false));
      selector.addEventListener("change", refreshStatus);
      parent.addEventListener("change", refreshStatus);
      refreshStatus();
    });
  }
  function syncLodesSelectors() {
    document.querySelectorAll("[data-selector]").forEach((selector) => {
      const input = document.querySelector('[data-category="' + selector.dataset.selector + '"]');
      selector.querySelectorAll('input[type="checkbox"]').forEach((item) => { item.disabled = !input || !input.checked || input.disabled; });
    });
  }
  function activateLodesCategory(category) {
    activeMode = "jobs";
    activeLodesCategory = category;
    syncLodesSelectors();
    updatePrimaryOptions();
    refreshMap();
  }
  function activateAcsCategory(category) {
    activeMode = "acs";
    activeAcsCategory = category;
    const fields = acsSelections[category] || selectedAcsFields(category) || ACS_CATEGORY_FIELDS[category] || [ACS_CATEGORY_DEFAULTS[category]];
    setAcsFields(category, fields);
    refreshMap();
  }
  function categoryForAcsField(field) {
    const groups = {
      population: ["B01001_001E", "B01001_003E", "B01001_020E", "B01001_027E", "B01001_044E"],
      "median-income": ["B19013_001E"],
      "aggregate-income": ["B19025_001E"],
      households: ["B11001_001E", "B11001_002E", "B11001_007E"],
      "per-capita": ["B19301_001E"],
      poverty: ["B17001_002E"],
      education: ["B15003_017E", "B15003_021E", "B15003_022E", "B15003_023E", "B15003_024E"],
      employment: ["B23025_003E", "B23025_004E", "B23025_005E"]
    };
    return Object.keys(groups).find((key) => groups[key].includes(field)) || "population";
  }
  function syncAcsActiveCategory(category) {
    activeAcsCategory = category;
    syncActiveAcsFields();
  }
  function showError(error) {
    console.error(error);
    els.status.textContent = "Data could not be loaded: " + error.message;
  }

  els.lodesMeasures.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        const selector = document.querySelector('[data-selector="' + input.dataset.category + '"]');
        if (selector) selector.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = true; });
      }
      updatePrimaryOptions();
      setPrimaryContext(els.primaryMeasure.value);
      syncLodesSelectors();
      refreshMap();
    });
  });
  document.querySelectorAll("[data-selector]").forEach((selector) => {
    selector.addEventListener("change", () => {
      const input = document.querySelector('[data-category="' + selector.dataset.selector + '"]');
      if (input && !input.checked) input.checked = true;
      updatePrimaryOptions();
      setPrimaryContext(els.primaryMeasure.value);
      refreshMap();
    });
  });
  els.basis.forEach((radio) => radio.addEventListener("change", () => {
    refreshMap();
  }));
  els.lodesYear.addEventListener("change", () => loadLodesYear(els.lodesYear.value).catch(showError));
  els.acsMeasures.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener("change", () => {
      const category = input.dataset.category;
      const selector = acsSelector(category);
      if (selector) selector.querySelectorAll('input[type="checkbox"]').forEach((item) => { item.disabled = !input.checked; });
      if (input.checked) activateAcsCategory(category);
      updatePrimaryOptions();
      setPrimaryContext(els.primaryMeasure.value);
      refreshMap();
    });
  });
  els.acsSelectors.forEach((selector) => {
    const category = selector.dataset.acsSelector;
    selector.querySelectorAll('input[type="checkbox"]').forEach((item) => { item.disabled = !document.querySelector('[data-category="' + category + '"]').checked; });
    selector.addEventListener("change", () => {
      let selected = selectedAcsFields(category);
      const parentTotals = {
        population: "B01001_001E",
        households: "B11001_001E",
        employment: "B23025_003E"
      };
      const parentTotal = parentTotals[category];
      if (parentTotal && selected.length > 1 && selected.includes(parentTotal)) {
        selected = selected.filter((field) => field !== parentTotal);
        setAcsFields(category, selected);
      }
      activeMode = "acs";
      activeAcsCategory = category;
      syncAcsActiveCategory(category);
      const categoryInput = document.querySelector('[data-category="' + category + '"]');
      if (categoryInput && !categoryInput.checked) categoryInput.checked = true;
      updatePrimaryOptions();
      setPrimaryContext(els.primaryMeasure.value);
      refreshMap();
    });
  });
  els.acsYear.addEventListener("change", () => {
    refreshMap();
  });
  els.mapMode.addEventListener("change", () => {
    mapMode = els.mapMode.value;
    els.primaryMeasure.disabled = mapMode === "combined" || !selectedMeasureKeys().length;
    refreshMap();
  });
  els.primaryMeasure.addEventListener("change", () => {
    setPrimaryContext(els.primaryMeasure.value);
    refreshMap();
  });

  els.acsSelectors.forEach((selector) => {
    const category = selector.dataset.acsSelector;
    acsSelections[category] = Array.from(selector.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
    selector.querySelectorAll('input[type="checkbox"]').forEach((item) => { item.disabled = !document.querySelector('[data-category="' + category + '"]').checked; });
  });
  updatePrimaryOptions();
  setPrimaryContext(els.primaryMeasure.value);
  syncLodesSelectors();
  setupBulkSelectionControls();

  fetch(GEOJSON_URL)
    .then((response) => {
      if (!response.ok) throw new Error("Could not load block-group GeoJSON (HTTP " + response.status + ").");
      return response.json();
    })
    .then((geojson) => {
      baseFeatures = geojson.features || [];
      if (!baseFeatures.length) throw new Error("The GeoJSON file contains no map features.");
      geojsonLayer = L.geoJSON(geojson, { style: styleFeature, onEachFeature }).addTo(map);
      map.fitBounds(geojsonLayer.getBounds(), { padding: [18, 18] });
      return loadLodesYear(els.lodesYear.value);
    })
    .catch(showError);
})();

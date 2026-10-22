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
  const COLORS = ["#f2f3ed", "#d4e2d7", "#a9c9b3", "#76a489", "#477b61", "#24513c"];
  const els = {
    lodesYear: document.querySelector("#lodes-year"),
    lodesMeasures: document.querySelector("#lodes-measures"),
    basis: Array.from(document.querySelectorAll('input[name="lodes-basis"]')),
    lodesNote: document.querySelector("#lodes-availability-note"),
    acsYear: document.querySelector("#acs-year"),
    acsMeasures: document.querySelector("#acs-measures"),
    acsDetail: document.querySelector("#acs-detail"),
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
  const selectedLodesCodes = () => {
    const selector = document.querySelector('[data-selector="' + activeLodesCategory + '"]');
    return selector ? Array.from(selector.selectedOptions).map((option) => option.value) : [];
  };
  const DOMINANT_ORDER = {
    earnings: ["CE03", "CE02", "CE01"],
    education: ["CD04", "CD03", "CD02", "CD01"],
    age: ["CA03", "CA02", "CA01"],
    sex: ["CS01", "CS02"],
    raceethnicity: ["CR01", "CR02", "CR03", "CR04", "CR05", "CR07", "CT01", "CT02"]
  };
  function dominantCategory(feature) {
    const row = selectedYearData.get(String((feature.properties || {}).GEOID ?? (feature.properties || {}).GEOIDFQ ?? ""));
    if (!row) return null;
    const selected = selectedLodesCodes();
    const ordered = (DOMINANT_ORDER[activeLodesCategory] || []).filter((code) => selected.includes(code));
    if (!ordered.length) return null;
    const counts = ordered.map((code) => ({ code, count: numeric(row[selectedBasis() + "_" + code]) }));
    if (counts.some((item) => item.count === null)) return null;
    const total = counts.reduce((sum, item) => sum + item.count, 0);
    if (!total) return null;
    const winner = counts.reduce((best, item) => item.count > best.count ? item : best);
    return { ...winner, share: winner.count / total, rank: ordered.indexOf(winner.code), ordered };
  }
  const isDominantMode = () => activeMode === "jobs" && !["total", "industry"].includes(activeLodesCategory);
  function activeMeta() {
    if (activeMode === "acs") {
      const fields = Array.from(els.acsDetail.selectedOptions).map((option) => option.value);
      const field = fields[0] || "B01001_001E";
      return ACS_FIELDS[field] || { label: "ACS measure", format: "number" };
    }
    if (activeLodesCategory === "industry") {
      return { label: "Combined jobs in selected industries", format: "number" };
    }
    if (isDominantMode()) {
      return { label: "Dominant " + LODES_META[activeLodesCategory].label.replace(/^Jobs by worker /, "worker ") + " category", format: "number", dominant: true };
    }
    return LODES_META.total;
  }
  function getValue(feature) {
    const p = feature.properties || {};
    if (activeMode === "acs") {
      const fields = Array.from(els.acsDetail.selectedOptions).map((option) => option.value);
      const field = fields[0] || "B01001_001E";
      return numeric(p[field]);
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
    return dominant ? dominant.rank : null;
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
    let fillColor = colorFor(getValue(feature), currentBreaks);
    if (isDominantMode()) {
      const dominant = dominantCategory(feature);
      if (!dominant) fillColor = "#d8dcd8";
      else {
        const paletteIndex = dominant.ordered.length <= 1 ? 0 :
          Math.round((dominant.rank / (dominant.ordered.length - 1)) * (COLORS.length - 1));
        fillColor = COLORS[COLORS.length - 1 - paletteIndex];
      }
    }
    return { fillColor, weight: 1, opacity: 1, color: "#ffffff", dashArray: "", fillOpacity: 0.82 };
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[ch]);
  }
  function popupContent(feature) {
    const p = feature.properties || {};
    const title = p.NAMELSAD || p.NAME || p.GEOID || "Census block group";
    const meta = activeMeta();
    const lines = [
      [meta.label, isDominantMode() ? ((dominantCategory(feature) || {}).code ? (DETAIL_LABELS[dominantCategory(feature).code] || dominantCategory(feature).code) : "No data") : formatValue(getValue(feature), meta.format)],
      ["Geographic ID", p.GEOID || "Not available"]
    ];
    if (isDominantMode()) {
      const dominant = dominantCategory(feature);
      if (dominant) {
        lines.push(["Share of selected categories", formatValue(dominant.share, "percent")]);
        lines.push(["Jobs in dominant category", formatValue(dominant.count)]);
      }
    }
    if (activeMode === "jobs") {
      const row = selectedYearData.get(String(p.GEOID || ""));
      if (row) {
        lines.push(["Jobs by workplace", formatValue(numeric(row.wac_jobs))]);
        lines.push(["Jobs by worker residence", formatValue(numeric(row.rac_jobs))]);
      }
      lines.push(["Source", "LODES " + els.lodesYear.value]);
      if (activeLodesCategory === "education" && Number(els.lodesYear.value) < 2009) {
        lines.push(["Availability", "Not published for this year"]);
      }
    } else {
      lines.push(["Source", "ACS " + els.acsYear.value + " five-year estimates"]);
    }
    return '<div class="popup-card"><h3 class="popup-title">' + escapeHtml(title) + '</h3>' +
      lines.map(([label, value]) => '<div class="popup-row"><span>' + escapeHtml(label) +
        '</span><strong>' + escapeHtml(value) + '</strong></div>').join("") + '</div>';
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
    if (isDominantMode()) {
      const selected = selectedLodesCodes();
      const ordered = (DOMINANT_ORDER[activeLodesCategory] || []).filter((code) => selected.includes(code));
      if (!ordered.length) {
        els.legend.textContent = "Select one or more subcategories to map.";
        return;
      }
      ordered.forEach((code, index) => {
        const row = document.createElement("div");
        row.className = "legend-row";
        const swatch = document.createElement("span");
        swatch.className = "legend-swatch";
        const paletteIndex = ordered.length <= 1 ? 0 : Math.round((index / (ordered.length - 1)) * (COLORS.length - 1));
        swatch.style.backgroundColor = COLORS[COLORS.length - 1 - paletteIndex];
        const label = document.createElement("span");
        label.textContent = DETAIL_LABELS[code] || code;
        row.append(swatch, label, document.createElement("span"));
        els.legend.appendChild(row);
      });
      const missing = document.createElement("div");
      missing.className = "legend-row";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = "#d8dcd8";
      const label = document.createElement("span");
      label.textContent = "No data";
      missing.append(swatch, label, document.createElement("span"));
      els.legend.appendChild(missing);
      return;
    }
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
  function refreshMap() {
    if (!geojsonLayer) return;
    currentBreaks = quantileBreaks(baseFeatures.map(getValue).filter((value) => value !== null));
    geojsonLayer.setStyle(styleFeature);
    updateLegend();
    els.period.textContent = activeMode === "jobs" ? "LODES · " + els.lodesYear.value :
      "ACS · " + els.acsYear.value + " five-year";
    els.status.textContent = baseFeatures.length + " block groups · " +
      baseFeatures.filter((feature) => getValue(feature) !== null).length + " with data";
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
      if (selector) selector.disabled = unavailable || !input.checked;
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
    refreshMap();
  }
  function syncLodesSelectors() {
    document.querySelectorAll("[data-selector]").forEach((selector) => {
    selector.addEventListener("change", () => {
      const input = document.querySelector('[data-category="' + selector.dataset.selector + '"]');
      if (input && !input.checked) input.checked = true;
      activateLodesCategory(selector.dataset.selector);
      syncLodesSelectors();
    });
  });
  els.basis.forEach((radio) => radio.addEventListener("change", () => {
    activateLodesCategory(activeLodesCategory);
  }));
  els.lodesYear.addEventListener("change", () => loadLodesYear(els.lodesYear.value).catch(showError));
  els.acsMeasures.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (input.checked) {
        activateAcsCategory(input.dataset.category);
      } else if (activeAcsCategory === input.dataset.category) {
        const fallback = els.acsMeasures.querySelector('input[type="checkbox"]:checked');
        if (fallback) activateAcsCategory(fallback.dataset.category);
        else {
          input.checked = true;
          activateAcsCategory(input.dataset.category);
        }
      }
    });
  });
  els.acsDetail.addEventListener("change", () => {
    syncAcsActiveCategory();
    activeMode = "acs";
    refreshMap();
  });
  els.acsYear.addEventListener("change", () => {
    activeMode = "acs";
    refreshMap();
  });

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

/* Map behavior and data loading. Visual design belongs in assets/css/map.css. */
(() => {
  "use strict";

  const GEOJSON_URL = "data/2023/flathead_economic_2023.geojson";

  function syncMapColumnHeight() {
    const settings = document.querySelector(".control-panel");
    const column = document.querySelector(".map-column");
    if (!settings || !column || !window.ResizeObserver) return;
    const updateHeight = () => {
      if (window.matchMedia("(min-width: 901px)").matches) {
        column.style.height = settings.getBoundingClientRect().height + "px";
      } else {
        column.style.height = "";
      }
    };
    const observer = new ResizeObserver(updateHeight);
    observer.observe(settings);
    window.addEventListener("resize", updateHeight);
    updateHeight();
  }

  const LODES_PATH = (year) => "data/lodes/" + year + "/flathead_lodes_characteristics_by_block_group.csv";
  const LODES_YEARS = Array.from({ length: 22 }, (_, i) => 2023 - i);
  const ACS_YEARS = Array.from({ length: 12 }, (_, i) => 2024 - i);
  const ACS_BG_PATH = (year) => "data/acs/acs5_" + year + "_flathead_block_groups.csv";
  const ACS_COUNTY_PATH = (year) => "data/acs/acs5_" + year + "_flathead_county.csv";
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
    B15003_018E: { label: "GED or alternative credential", format: "number" },
    B15003_019E: { label: "Some college, less than one year", format: "number" },
    B15003_020E: { label: "Some college, one or more years, no degree", format: "number" },
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
    population: ["B01001_001E", "B01001_003E", "B01001_020E", "B01001_027E", "B01001_044E"],
    "median-income": ["B19013_001E"],
    "aggregate-income": ["B19025_001E"],
    households: ["B11001_001E", "B11001_002E", "B11001_007E"],
    "per-capita": ["B19301_001E"],
    poverty: ["B17001_002E"],
    education: ["B15003_017E", "B15003_018E", "B15003_019E", "B15003_020E", "B15003_021E", "B15003_022E", "B15003_023E", "B15003_024E"],
    employment: ["B23025_004E", "B23025_005E"]
  };
  // Muted sequential scale for map intensity, from low to high.
  const COLORS = ["#dce8f4", "#c1d5e9", "#91b4d8", "#5e8fbe", "#32699d", "#173f68"];
  // Muted, varied categorical colors shared by the written lists and charts.
  const CATEGORY_COLORS = [
    "#3185d8", "#ed7655", "#35a66f", "#9563c7", "#e5a52f",
    "#20a6a1", "#d65c91", "#8a9f35", "#675fc0", "#e4863d",
    "#168b79", "#d9534f", "#5278d5", "#bd5680", "#78a943",
    "#d27a42", "#328eb8", "#a45cc2", "#3d9b91", "#dc6b68"
  ];
  const categoryColor = (index) => CATEGORY_COLORS[index % CATEGORY_COLORS.length];
  syncMapColumnHeight();

  const els = {
    lodesYear: document.querySelector("#lodes-year"),
    lodesMeasures: document.querySelector("#lodes-measures"),
    mapMode: document.querySelector("#map-mode"),
    primaryMeasure: document.querySelector("#primary-measure"),
    primaryYear: document.querySelector("#primary-year"),
    basis: Array.from(document.querySelectorAll('input[name="lodes-basis"]')),
    lodesNote: document.querySelector("#lodes-availability-note"),
    acsYear: document.querySelector("#acs-year"),
    acsMeasures: document.querySelector("#acs-measures"),
    acsDetail: document.querySelector("#acs-detail"),
    acsSelectors: Array.from(document.querySelectorAll("[data-acs-selector]")),
    legendTitle: document.querySelector("#legend-title"),
    legendDescription: document.querySelector("#legend-description"),
    legend: document.querySelector("#legend"),
    status: document.querySelector("#map-status"),
    period: document.querySelector("#map-period"),
    graphSection: document.querySelector("#map-graph-section"),
    graphSelect: document.querySelector("#map-graph-select"),
    graph: document.querySelector("#map-graph")
  };

  const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([48.25, -114.25], 9);

  const settingsPanel = document.querySelector(".control-panel");
  const settingsToggle = document.querySelector("#settings-collapse-toggle");
  const appShell = document.querySelector(".app-shell");
  function setSettingsCollapsed(collapsed) {
    if (!settingsPanel || !settingsToggle || !appShell) return;
    if (collapsed && window.matchMedia("(min-width: 901px)").matches) {
      settingsPanel.style.minHeight = settingsPanel.getBoundingClientRect().height + "px";
      appShell.classList.add("settings-collapsed");
    } else {
      appShell.classList.remove("settings-collapsed");
      settingsPanel.style.minHeight = "";
      collapsed = false;
    }
    settingsToggle.textContent = collapsed ? "›" : "‹";
    settingsToggle.setAttribute("aria-expanded", String(!collapsed));
    settingsToggle.setAttribute("aria-label", collapsed ? "Expand Map Settings" : "Collapse Map Settings");
    settingsToggle.title = collapsed ? "Expand Map Settings" : "Collapse Map Settings";
    requestAnimationFrame(() => map.invalidateSize({ pan: false }));
  }
  if (settingsToggle) {
    settingsToggle.addEventListener("click", () => {
      setSettingsCollapsed(!appShell.classList.contains("settings-collapsed"));
    });
    window.addEventListener("resize", () => {
      if (!window.matchMedia("(min-width: 901px)").matches &&
          appShell.classList.contains("settings-collapsed")) {
        setSettingsCollapsed(false);
      }
    });
  }

  // Keep Leaflet's renderer dimensions synchronized with the map container.
  // The container can resize when the settings column changes height, even
  // when the browser window itself has not been resized.
  const mapContainer = map.getContainer();
  if (window.ResizeObserver) {
    const mapResizeObserver = new ResizeObserver(() => {
      map.invalidateSize({ pan: false });
    });
    mapResizeObserver.observe(mapContainer);
  } else {
    window.addEventListener("resize", () => map.invalidateSize({ pan: false }));
  }
  map.invalidateSize({ pan: false });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  let geojsonLayer = null;
  let baseFeatures = [];
  let selectedYearData = new Map();
  const lodesDataByYear = new Map();
  const acsDataByYear = new Map();
  let activeDisplayYear = "2023";
  let activeMode = "jobs";
  let activeLodesCategory = "total";
  let activeAcsCategory = "population";
  let mapMode = "single";
  let compositeValues = new Map();
  let compositeError = "";
  let currentBreaks = [];
  let selectedFeature = null;
  const selectedFeatureIds = new Set();
  let ignoreNextMapClick = false;
  let dataPanelView = "block";
  let countyAcsData = null;

  LODES_YEARS.forEach((year) => els.lodesYear.add(new Option(String(year), String(year))));
  els.lodesYear.multiple = true;
  Array.from(els.lodesYear.options).forEach((option) => { option.selected = option.value === "2023"; });
  els.acsYear.replaceChildren();
  ACS_YEARS.forEach((year) => els.acsYear.add(new Option(year + " (" + (year - 4) + "–" + year + ")", String(year))));
  els.acsYear.multiple = true;
  Array.from(els.acsYear.options).forEach((option) => { option.selected = option.value === "2024"; });
  function selectedYears(select) {
    return Array.from(select.selectedOptions).map((option) => option.value).sort((a, b) => Number(a) - Number(b));
  }

  // Keep the native multi-select as the data source, but present years in a
  // compact dropdown with an explicit checkbox for each available year.
  function createYearDropdown(select, label) {
    const wrapper = document.createElement("div");
    wrapper.className = "year-dropdown";
    wrapper.dataset.yearDropdown = select.id;
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "year-dropdown-trigger";
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");
    const triggerText = document.createElement("span");
    const caret = document.createElement("span");
    caret.className = "year-dropdown-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "▾";
    trigger.append(triggerText, caret);
    const menu = document.createElement("div");
    menu.className = "year-dropdown-menu";
    menu.hidden = true;
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", label + " years");
    function sync() {
      const selected = selectedYears(select);
      triggerText.textContent = selected.length === 1
        ? (Array.from(select.options).find((option) => option.value === selected[0])?.textContent || selected[0])
        : selected.length + " years selected";
      menu.replaceChildren();
      Array.from(select.options).forEach((option) => {
        const row = document.createElement("label");
        row.className = "year-dropdown-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = option.value;
        checkbox.checked = option.selected;
        checkbox.addEventListener("change", () => {
          option.selected = checkbox.checked;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        const text = document.createElement("span");
        text.textContent = option.textContent;
        row.append(checkbox, text);
        menu.appendChild(row);
      });
    }
    trigger.addEventListener("click", () => {
      const opening = menu.hidden;
      document.querySelectorAll(".year-dropdown-menu").forEach((other) => { other.hidden = true; });
      document.querySelectorAll(".year-dropdown-trigger").forEach((other) => other.setAttribute("aria-expanded", "false"));
      menu.hidden = !opening;
      trigger.setAttribute("aria-expanded", String(opening));
    });
    select.addEventListener("change", sync);
    select.classList.add("year-dropdown-native");
    wrapper.append(trigger, menu);
    select.insertAdjacentElement("afterend", wrapper);
    sync();
  }
  createYearDropdown(els.lodesYear, "Employment");
  createYearDropdown(els.acsYear, "Population");
  document.addEventListener("click", (event) => {
    if (event.target.closest(".year-dropdown")) return;
    document.querySelectorAll(".year-dropdown-menu").forEach((menu) => { menu.hidden = true; });
    document.querySelectorAll(".year-dropdown-trigger").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
  });
  function ensureDisplayYear(select, current) {
    const years = selectedYears(select);
    if (!years.length) {
      const fallback = select === els.lodesYear ? "2023" : "2024";
      const option = Array.from(select.options).find((item) => item.value === fallback) || select.options[0];
      if (option) option.selected = true;
      return option ? option.value : fallback;
    }
    return years.includes(String(current)) ? String(current) : years[years.length - 1];
  }
  function updatePrimaryYearOptions() {
    if (!els.primaryYear) return;
    const select = activeMode === "jobs" ? els.lodesYear : els.acsYear;
    const years = selectedYears(select);
    activeDisplayYear = ensureDisplayYear(select, activeDisplayYear);
    els.primaryYear.replaceChildren(...years.map((year) => new Option(year, year)));
    els.primaryYear.value = activeDisplayYear;
    els.primaryYear.hidden = years.length < 2;
    const label = els.primaryYear.previousElementSibling;
    if (label) label.hidden = years.length < 2;
  }

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
  const ORDINAL_SCORES = {
    earnings: { CE01: 1, CE02: 2, CE03: 3 },
    education: { CD01: 1, CD02: 2, CD03: 3, CD04: 4 },
    age: { CA01: 1, CA02: 2, CA03: 3 }
  };
  const isOrdinalMode = () => mapMode === "single" && activeMode === "jobs" &&
    Object.prototype.hasOwnProperty.call(ORDINAL_SCORES, activeLodesCategory);
  const isNominalCategory = (mode, category) =>
    (mode === "jobs" && ["industry", "raceethnicity", "sex"].includes(category)) ||
    (mode === "acs" && ["households", "employment"].includes(category));
  const isNominalMode = () => mapMode === "single" && isNominalCategory(activeMode,
    activeMode === "jobs" ? activeLodesCategory : activeAcsCategory);
  function nominalSelectedCodes() {
    if (activeMode === "jobs") return selectedLodesCodes();
    const denominator = activeAcsCategory === "households" ? "B11001_001E" : "B23025_003E";
    return selectedAcsFields().filter((field) => field !== denominator);
  }
  function nominalSelection(feature) {
    const p = feature.properties || {};
    let selected = [], counts = [], denominator = null;
    if (activeMode === "jobs") {
      const row = selectedYearData.get(String(p.GEOID ?? p.GEOIDFQ ?? ""));
      if (!row) return null;
      selected = selectedLodesCodes();
      if (activeLodesCategory === "raceethnicity") {
        const race = selected.filter((code) => code.startsWith("CR"));
        const ethnicity = selected.filter((code) => code.startsWith("CT"));
        if (race.length && ethnicity.length) return null;
        selected = race.length ? race : ethnicity;
      }
      const prefix = selectedBasis() + "_";
      counts = selected.map((code) => ({ code, count: numeric(row[prefix + code]) }));
      denominator = numeric(row[prefix + "_jobs"]);
    } else {
      selected = nominalSelectedCodes();
      counts = selected.map((field) => ({ code: field, count: numeric(p[field]) }));
      const denominatorField = activeAcsCategory === "households" ? "B11001_001E" : "B23025_003E";
      denominator = numeric(p[denominatorField]);
    }
    if (!selected.length || counts.some((item) => item.count === null)) return null;
    const winner = counts.reduce((best, item) => item.count > best.count ? item : best);
    return { selected, counts, winner, denominator,
      share: denominator > 0 ? winner.count / denominator : null };
  }
  function ordinalWeightedValue(feature) {
    const p = feature.properties || {};
    const row = selectedYearData.get(String(p.GEOID ?? p.GEOIDFQ ?? ""));
    if (!row) return null;
    const scores = ORDINAL_SCORES[activeLodesCategory] || {};
    const codes = selectedLodesCodes().filter((code) => scores[code] !== undefined);
    if (!codes.length) return null;
    const values = codes.map((code) => ({ code, count: numeric(row[selectedBasis() + "_" + code]), score: scores[code] }));
    if (values.some((item) => item.count === null)) return null;
    const total = values.reduce((sum, item) => sum + item.count, 0);
    return total > 0 ? values.reduce((sum, item) => sum + item.score * item.count, 0) / total : null;
  }
  function nominalCategoryColor(code) {
    let order = [];
    if (activeMode === "jobs") {
      order = activeLodesCategory === "industry" ? Object.keys(INDUSTRY_LABELS) :
        activeLodesCategory === "sex" ? DOMINANT_ORDER.sex : DOMINANT_ORDER.raceethnicity;
    } else {
      order = ACS_CATEGORY_FIELDS[activeAcsCategory] || [];
    }
    return categoryColor(Math.max(0, order.indexOf(code)));
  }
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
  function activeMeta() {
    if (mapMode === "combined") {
      return { label: "Combined index · equal-weight normalized score", format: "number" };
    }
    if (isNominalMode()) {
      const selected = nominalSelectedCodes();
      if (selected.length > 1) return { label: "Dominant selected category", format: "number", categorical: true };
      const label = activeMode === "jobs"
        ? (activeLodesCategory === "industry" ? "Industry share of all jobs" :
          activeLodesCategory === "sex" ? "Worker sex share of all jobs" : "Selected race or ethnicity share of all jobs")
        : (activeAcsCategory === "households" ? "Household composition share" : "Employment status share of civilian labor force");
      return { label, format: "percent", percentage: true };
    }
    if (activeMode === "acs") {
      const fields = selectedAcsFields(activeAcsCategory);
      if (fields.length > 1) return { label: "Combined selected ACS subcategories", format: "number" };
      const field = fields[0] || "B01001_001E";
      return ACS_FIELDS[field] || { label: "ACS measure", format: "number" };
    }
    if (isOrdinalMode()) {
      return { label: "Ordinal weighted distribution index", format: "number", ordinal: true };
    }
    if (activeLodesCategory === "industry") return { label: "Combined jobs in selected industries", format: "number" };
    return LODES_META.total;
  }
  function getSingleValue(feature) {
    const p = feature.properties || {};
    if (activeMode === "acs") {
      const fields = selectedAcsFields(activeAcsCategory);
      if (!fields.length) return null;
      if (isNominalMode()) {
        const selection = nominalSelection(feature);
        if (!selection) return null;
        return selection.selected.length > 1 ? selection.winner.count : selection.share;
      }
      const values = fields.map((field) => numeric(p[field]));
      if (values.some((value) => value === null)) return null;
      return values.reduce((sum, value) => sum + value, 0);
    }
    const row = selectedYearData.get(String(p.GEOID ?? p.GEOIDFQ ?? ""));
    if (!row) return null;
    if (isOrdinalMode()) return ordinalWeightedValue(feature);
    if (isNominalMode()) {
      const selection = nominalSelection(feature);
      if (!selection) return null;
      return selection.selected.length > 1 ? selection.winner.count : selection.share;
    }
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
    let fillColor;
    if (isNominalMode() && nominalSelectedCodes().length > 1) {
      const selection = nominalSelection(feature);
      fillColor = selection ? nominalCategoryColor(selection.winner.code) : "#d8dcd8";
    } else {
      fillColor = colorFor(getValue(feature), currentBreaks);
    }
    const selected = selectedFeatureIds.has(selectedFeatureId(feature));
    return selected
      ? { fillColor, weight: 4, opacity: 1, color: "#ffb000", dashArray: "5 3", fillOpacity: 0.9 }
      : { fillColor, weight: 1, opacity: 1, color: "#ffffff", dashArray: "", fillOpacity: 0.68 };
  }
  function refreshSelectionStyles() {
    if (geojsonLayer) geojsonLayer.eachLayer((layer) => geojsonLayer.resetStyle(layer));
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
        if (isOrdinalMode()) {
          const codes = selectedLodesCodes();
          const scores = ORDINAL_SCORES[activeLodesCategory];
          const total = codes.reduce((sum, code) => sum + (numeric(row[selectedBasis() + "_" + code]) || 0), 0);
          lines.push(["Ordinal weighted distribution index", formatValue(getValue(feature), "number")]);
          lines.push(["Total jobs in block group", formatValue(numeric(row[selectedBasis() + "_jobs"]))]);
          lines.push(["Selected subcategory counts and scores", ""]);
          codes.forEach((code) => {
            lines.push([(DETAIL_LABELS[code] || code) + " · score " + scores[code], formatValue(numeric(row[selectedBasis() + "_" + code]))]);
          });
          lines.push(["Index method", "Sum of (category score × jobs) ÷ jobs across selected subcategories"]);
          lines.push(["Jobs in selected subcategories", formatValue(total)]);
        } else if (isNominalMode()) {
          const selection = nominalSelection(feature);
          const codes = selectedLodesCodes();
          const selected = activeMode === "jobs" ? codes : selectedAcsFields();
          const totalJobs = numeric(row[selectedBasis() + "_jobs"]);
          lines.push(["Total jobs in block group", formatValue(totalJobs)]);
          if (selected.length === 1) {
            lines.push([meta.label, selection ? formatValue(selection.share, "percent") : "No data"]);
            lines.push(["Jobs in selected category", selection ? formatValue(selection.winner.count) : "No data"]);
          } else {
            lines.push(["Dominant selected category", selection ? (DETAIL_LABELS[selection.winner.code] || optionLabel(selection.winner.code)) : "No data"]);
            lines.push(["Jobs in dominant category", selection ? formatValue(selection.winner.count) : "No data"]);
          }
          lines.push(["Selected subcategory counts", ""]);
          selection && selection.counts.forEach((item) => {
            lines.push([DETAIL_LABELS[item.code] || optionLabel(item.code), formatValue(item.count)]);
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
      const fields = isNominalMode() ? nominalSelectedCodes() : selectedAcsFields(activeAcsCategory);
      const values = fields.map((field) => ({ field, value: numeric(p[field]) }));
      lines.push([meta.label, formatValue(getValue(feature), meta.format)]);
      if (isNominalMode()) {
        const selection = nominalSelection(feature);
        if (fields.length > 1) {
          const winnerLabel = selection
            ? ((ACS_FIELDS[selection.winner.code] || {}).label || optionLabel(selection.winner.code))
            : "No data";
          lines.push(["Dominant selected category", winnerLabel]);
          lines.push(["Count in dominant category", selection ? formatValue(selection.winner.count) : "No data"]);
        } else {
          lines.push(["Selected category count", selection ? formatValue(selection.winner.count) : "No data"]);
          lines.push(["Denominator", formatValue(selection && selection.denominator)]);
        }
      }
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

  const DATA_PANEL_LABELS = { total:"Total jobs", industry:"Industry groups", earnings:"Worker earnings", education:"Worker education", age:"Worker age", raceethnicity:"Worker race & ethnicity", sex:"Worker sex" };
  function selectedFeatureId(feature) {
    const p = feature && feature.properties ? feature.properties : {};
    return String(p.GEOID ?? p.GEOIDFQ ?? "");
  }
  function countyLodesValue(field) {
    const basis = selectedBasis();
    let sum = 0, count = 0;
    selectedYearData.forEach((row) => {
      const value = numeric(row[basis + "_" + field]);
      if (value !== null) { sum += value; count += 1; }
    });
    return { value: count ? sum : null, count };
  }
  const dataPanelFormatModes = new Map();

  function appendValueLine(container, label, value, format, color) {
    const line = document.createElement("div");
    line.className = "data-card-value";
    const swatch = document.createElement("span");
    swatch.className = "data-card-value-swatch";
    swatch.style.backgroundColor = color || "transparent";
    const name = document.createElement("span");
    name.className = "data-card-value-name";
    name.textContent = label;
    const amount = document.createElement("strong");
    amount.textContent = formatValue(value, format || "number");
    line.append(swatch, name, amount);
    container.appendChild(line);
  }
  function appendComparisonHeader(card) {
    const header = document.createElement("div");
    header.className = "data-card-comparison-header";
    const spacer = document.createElement("span");
    const label = document.createElement("span");
    label.textContent = "Measure";
    const county = document.createElement("strong");
    county.textContent = "County";
    const blockGroup = document.createElement("strong");
    blockGroup.textContent = "Block group";
    header.append(spacer, label, county, blockGroup);
    card.appendChild(header);
  }
  function appendComparisonLine(container, label, countyValue, blockValue, format, color) {
    const line = document.createElement("div");
    line.className = "data-card-comparison-line";
    const swatch = document.createElement("span");
    swatch.className = "data-card-value-swatch";
    swatch.style.backgroundColor = color || "transparent";
    const name = document.createElement("span");
    name.className = "data-card-value-name";
    name.textContent = label;
    const county = document.createElement("strong");
    county.textContent = formatValue(countyValue, format || "number");
    const blockGroup = document.createElement("strong");
    blockGroup.textContent = formatValue(blockValue, format || "number");
    line.append(swatch, name, county, blockGroup);
    container.appendChild(line);
  }
  function addChart(card, entries, chartKey) {
    const valid = entries.filter((entry) => (entry.value ?? entry.countyValue) !== null && (entry.value ?? entry.countyValue) >= 0);
    if (valid.length < 2 || valid.every((entry) => (entry.value ?? entry.countyValue) === 0)) return;
    const heading = card.querySelector(".data-card-heading");
    const formatToggle = document.createElement("div"); formatToggle.className = "data-card-format-toggle";
    formatToggle.setAttribute("role", "group"); formatToggle.setAttribute("aria-label", "Display values as counts or percentages");
    const countButton = document.createElement("button"), percentButton = document.createElement("button");
    countButton.type = percentButton.type = "button"; countButton.textContent = "#"; percentButton.textContent = "%";
    countButton.setAttribute("aria-label", "Show counts"); percentButton.setAttribute("aria-label", "Show percentages");
    formatToggle.append(countButton, percentButton);
    if (heading) heading.appendChild(formatToggle);

    const total = valid.reduce((sum, entry) => sum + (entry.value ?? entry.countyValue), 0);
    const valuesByLabel = new Map(valid.map((entry) => [entry.label, entry.value ?? entry.countyValue]));
    const updateCardFormat = (format) => {
      countButton.setAttribute("aria-pressed", String(format === "count"));
      percentButton.setAttribute("aria-pressed", String(format === "percent"));
      card.querySelectorAll(".data-card-value").forEach((line) => {
        const label = line.querySelector(".data-card-value-name")?.textContent;
        const amount = line.querySelector("strong");
        if (!amount || !valuesByLabel.has(label)) return;
        const value = valuesByLabel.get(label);
        amount.textContent = format === "percent"
          ? (total > 0 ? (value / total * 100).toFixed(1) + "%" : "—")
          : formatValue(value);
      });
    };
    const setFormat = (format) => {
      dataPanelFormatModes.set(chartKey, format);
      updateCardFormat(format);
    };
    countButton.addEventListener("click", () => setFormat("count"));
    percentButton.addEventListener("click", () => setFormat("percent"));

    const chart = document.createElement("div"); chart.className = "data-card-chart";
    const controls = document.createElement("div"); controls.className = "data-chart-controls";
    const barsButton = document.createElement("button"), pieButton = document.createElement("button");
    barsButton.type = pieButton.type = "button"; barsButton.textContent = "Bar"; pieButton.textContent = "Pie";
    barsButton.setAttribute("aria-pressed","true"); pieButton.setAttribute("aria-pressed","false");
    const visual = document.createElement("div"); visual.className = "data-bars";
    const render = (mode) => {
      barsButton.setAttribute("aria-pressed",String(mode === "bar")); pieButton.setAttribute("aria-pressed",String(mode === "pie"));
      visual.replaceChildren();
      if (mode === "bar") {
        const max = Math.max(...valid.map((entry) => entry.value ?? entry.countyValue),1);
        valid.forEach((entry, index) => {
          const group = document.createElement("div"); group.className = "data-bar-group";
          const bar = document.createElement("div"); bar.className = "data-bar-line";
          const track = document.createElement("span"); track.className = "data-bar-track";
          const fill = document.createElement("span"); fill.className = "data-bar-fill";
          fill.style.backgroundColor = entry.color || categoryColor(index);
          const value = entry.value ?? entry.countyValue;
          fill.style.height = (value === null ? 0 : value / max * 100) + "%";
          track.appendChild(fill);
          const amount = document.createElement("strong"); amount.className = "data-bar-value"; amount.textContent = formatValue(value);
          bar.append(track,amount); group.appendChild(bar); visual.appendChild(group);
        });
      } else {
        const pieValues = valid.map((entry) => ({label:entry.label,value:entry.value ?? entry.countyValue,color:entry.color || categoryColor(valid.indexOf(entry))})).filter((entry) => entry.value !== null && entry.value >= 0);
        const pieTotal = pieValues.reduce((sum,entry)=>sum+entry.value,0);
        if (!pieTotal) { visual.textContent = "No values available for this chart."; return; }
        let cursor=0;
        const stops=pieValues.map((entry)=>{const from=cursor;cursor+=entry.value/pieTotal*100;return entry.color+" "+from+"% "+cursor+"%";});
        const layout=document.createElement("div");layout.className="data-pie-layout";
        const pie=document.createElement("div");pie.className="data-pie";pie.style.setProperty("--pie-gradient","conic-gradient("+stops.join(",")+")");
        layout.appendChild(pie);visual.appendChild(layout);
      }
    };
    barsButton.addEventListener("click",()=>render("bar"));pieButton.addEventListener("click",()=>render("pie"));
    controls.append(barsButton,pieButton);chart.append(controls,visual);card.appendChild(chart);
    updateCardFormat(dataPanelFormatModes.get(chartKey) || "count");
    render("bar");
  }
  function updateSourceHeadings() {
    const employmentHeading = document.querySelector("#employment-heading");
    const populationHeading = document.querySelector("#population-heading");
    if (employmentHeading) employmentHeading.textContent = "Employment Data - Source: LODES " + activeDisplayYear;
    if (populationHeading) populationHeading.textContent = "Population Data - Source: ACS " +
      (Number(activeDisplayYear) - 4) + "–" + activeDisplayYear;
  }

  function renderDataPanel() {
    updateSourceHeadings();
    const host = document.querySelector("#data-panel-cards");
    const selection = document.querySelector("#data-panel-selection");
    const viewSwitch = document.querySelector("#data-panel-view-switch");
    if (!host || !selection) return;
    host.replaceChildren();
    if (!baseFeatures.length || !countyAcsData) {
      host.textContent = "Loading county and block-group data…";
      return;
    }
    const selectedId = selectedFeature ? selectedFeatureId(selectedFeature) : "";
    const compareMode = Boolean(selectedFeature && dataPanelView === "compare");
    if (viewSwitch) {
      viewSwitch.hidden = !selectedFeature;
      viewSwitch.querySelectorAll("button[data-view]").forEach((button) => {
        button.setAttribute("aria-pressed", String(button.dataset.view === dataPanelView));
      });
    }
    if (selectedFeature) {
      const selectedNames = baseFeatures
        .filter((feature) => selectedFeatureIds.has(selectedFeatureId(feature)))
        .map((feature) => feature.properties.NAMELSAD || ("Block Group " + selectedFeatureId(feature).slice(-1)));
      const activeName = selectedFeature.properties.NAMELSAD || ("Block Group " + selectedId.slice(-1));
      selection.textContent = selectedNames.length > 1
        ? "Selected " + selectedNames.length + " block groups: " + selectedNames.join(", ") +
          ". Showing details for " + activeName + "."
        : activeName;
    } else {
      selection.textContent = "Showing Flathead County totals.";
    }
    const appendSectionHeading = (label, className) => {
      const heading = document.createElement("h3");
      heading.className = "data-panel-group-heading " + className;
      heading.textContent = label;
      host.appendChild(heading);
    };
    const appendCards = (source, categories) => {
      categories.forEach((category) => {
        const card = document.createElement("article");
        card.className = "data-card";
        const title = document.createElement("h3");
        title.textContent = source === "jobs" ? DATA_PANEL_LABELS[category] : ACS_CATEGORY_LABELS[category];
        const heading = document.createElement("div");
        heading.className = "data-card-heading";
        heading.appendChild(title);
        card.appendChild(heading);
        if (compareMode) appendComparisonHeader(card);
        const entries = [];
        if (source === "jobs") {
          const selector = document.querySelector('[data-selector="' + category + '"]');
          const fields = category === "total" ? ["jobs"] :
            (selector ? Array.from(selector.querySelectorAll('input[type="checkbox"]')).map((input) => input.value) : []);
          const basis = selectedBasis();
          const row = selectedFeature ? selectedYearData.get(selectedId) : null;
          const orderedFields = fields.map((field, index) => {
            const countyResult = countyLodesValue(field);
            const blockValue = row ? numeric(row[basis + "_" + field]) : null;
            return { field, index, value: selectedFeature ? blockValue : countyResult.value, countyResult, blockValue };
          }).sort((a, b) => {
            if (a.value === null) return b.value === null ? 0 : 1;
            if (b.value === null) return -1;
            return b.value - a.value;
          });
          orderedFields.forEach(({ field, countyResult, blockValue }, rank) => {
            const color = categoryColor(rank);
            const label = category === "total" ? "Total jobs" :
              (DETAIL_LABELS[field] || INDUSTRY_LABELS[field] || optionLabel(field));
            if (!selectedFeature) appendValueLine(card, label, countyResult.value, "number", color);
            else if (compareMode) appendComparisonLine(card, label, countyResult.value, blockValue, "number", color);
            else appendValueLine(card, label, blockValue, "number", color);
            entries.push({label, value:selectedFeature ? blockValue : countyResult.value, countyValue:countyResult.value, color});
          });
          const expected = baseFeatures.length;
          const coverage = fields.length ? Math.min(...fields.map((field) => countyLodesValue(field).count)) : 0;
          if (coverage < expected) {
            const note = document.createElement("p");
            note.className = "data-panel-note data-card-warning";
            note.textContent = (basis === "wac" ? "Workplace" : "Residence") +
              " coverage: " + coverage + " of " + expected +
              " block groups with records. Missing records are not assumed to be zero.";
            card.appendChild(note);
          }
          if (!compareMode && category !== "total") addChart(card, entries, "jobs-" + category);
          const note = document.createElement("p");
          note.className = "data-panel-note";
          note.textContent = "LODES " + els.lodesYear.value + " · " +
            (basis === "rac" ? "worker residence" : "workplace");
          card.appendChild(note);
        } else {
          const fields = ACS_CATEGORY_FIELDS[category] || [];
          const orderedFields = fields.map((field, index) => {
            const countyValue = numeric(countyAcsData[field]);
            const blockValue = selectedFeature ? numeric(selectedFeature.properties[field]) : null;
            const label = (ACS_FIELDS[field] || {}).label || optionLabel(field);
            return { field, index, countyValue, blockValue, label, value: selectedFeature ? blockValue : countyValue };
          }).sort((a, b) => {
            const aTotal = a.label.toLowerCase().startsWith("total ");
            const bTotal = b.label.toLowerCase().startsWith("total ");
            if (aTotal !== bTotal) return aTotal ? -1 : 1;
            if (a.value === null) return b.value === null ? 0 : 1;
            if (b.value === null) return -1;
            return b.value - a.value;
          });
          orderedFields.forEach(({ field, countyValue, blockValue, label }, rank) => {
            const color = categoryColor(rank);
            const format = (ACS_FIELDS[field] || {}).format;
            if (!selectedFeature) appendValueLine(card, label, countyValue, format, color);
            else if (compareMode) appendComparisonLine(card, label, countyValue, blockValue, format, color);
            else appendValueLine(card, label, blockValue, format, color);
            entries.push({label, value:selectedFeature ? blockValue : countyValue, countyValue, color});
          });
          const chartEntries = entries.filter((entry) => !entry.label.toLowerCase().startsWith("total "));
          if (!compareMode && chartEntries.length > 1) addChart(card, chartEntries, "acs-" + category);
          const note = document.createElement("p");
          note.className = "data-panel-note";
          note.textContent = "ACS " + els.acsYear.value + " five-year estimates.";
          card.appendChild(note);
        }
        host.appendChild(card);
      });
    };
    appendSectionHeading("Employment Data - Source: LODES " + els.lodesYear.value, "lodes");
    appendCards("jobs", Object.keys(DATA_PANEL_LABELS));
    appendSectionHeading("Population Data - Source: ACS " + (Number(els.acsYear.value) - 4) + "–" + els.acsYear.value, "acs");
    appendCards("acs", Object.keys(ACS_CATEGORY_LABELS));
  }
  const dataPanelViewSwitch = document.querySelector("#data-panel-view-switch");
  if (dataPanelViewSwitch) {
    dataPanelViewSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-view]");
      if (!button || !selectedFeature) return;
      dataPanelView = button.dataset.view;
      renderDataPanel();
    });
  }

  function onEachFeature(feature, layer) {
    layer.bindPopup(() => popupContent(feature));
    layer.on("click", (event) => {
      ignoreNextMapClick = true;
      const id = selectedFeatureId(feature);
      const original = event.originalEvent || {};
      const additiveSelection = Boolean(original.shiftKey || original.metaKey || original.ctrlKey);
      if (additiveSelection) {
        if (selectedFeatureIds.has(id)) selectedFeatureIds.delete(id);
        else selectedFeatureIds.add(id);
      } else {
        selectedFeatureIds.clear();
        selectedFeatureIds.add(id);
      }
      selectedFeature = selectedFeatureIds.has(id)
        ? feature
        : (selectedFeatureIds.size
          ? baseFeatures.find((item) => selectedFeatureId(item) === Array.from(selectedFeatureIds).slice(-1)[0]) || null
          : null);
      if (!selectedFeatureIds.size) dataPanelView = "block";
      refreshSelectionStyles();
      renderDataPanel();
      renderMapGraph();
      if (selectedFeature) layer.openPopup();
      else map.closePopup();
    });
    layer.on({
      mouseover: (event) => {
        if (!selectedFeatureIds.has(selectedFeatureId(feature))) {
          event.target.setStyle({ weight: 2.5, color: "#1c3328", fillOpacity: 0.82 });
        }
      },
      mouseout: (event) => { if (geojsonLayer) geojsonLayer.resetStyle(event.target); }
    });
  }
  map.on("click", () => {
    if (ignoreNextMapClick) {
      ignoreNextMapClick = false;
      return;
    }
    if (!selectedFeatureIds.size) return;
    selectedFeatureIds.clear();
    selectedFeature = null;
    dataPanelView = "block";
    refreshSelectionStyles();
    map.closePopup();
    renderDataPanel();
    renderMapGraph();
  });

  function combinedVariableDescriptions(keys) {
    return keys.map((key) => {
      const [source, category] = key.split(":");
      const root = source === "jobs" ? els.lodesMeasures : els.acsMeasures;
      const selectorAttr = source === "jobs" ? "data-selector" : "data-acs-selector";
      const group = root.querySelector('[' + selectorAttr + '="' + category + '"]');
      const categoryInput = root.querySelector('input[data-category="' + category + '"]');
      const categoryLabel = categoryInput?.closest("label")?.querySelector("span")?.textContent.trim()
        || measureLabel(key);
      if (!group) return categoryLabel;
      const allOptions = Array.from(group.querySelectorAll('input[type="checkbox"]:not(:disabled)'));
      const selectedInputs = allOptions.filter((input) => input.checked);
      if (allOptions.length && selectedInputs.length === allOptions.length) {
        return categoryLabel + " (all)";
      }
      const selected = selectedInputs
        .map((input) => input.closest("label")?.querySelector("span")?.textContent.trim())
        .filter(Boolean);
      return categoryLabel + (selected.length ? ": " + selected.join(", ") : ": no subcategories selected");
    });
  }
  function updateLegend() {
    const meta = activeMeta();
    els.legendTitle.textContent = meta.label;
    els.legendDescription.replaceChildren();
    els.legendDescription.hidden = true;
    if (mapMode === "combined") {
      els.legendDescription.hidden = false;
      const variablesTitle = document.createElement("strong");
      variablesTitle.textContent = "Variables";
      const variables = document.createElement("ul");
      combinedVariableDescriptions(selectedMeasureKeys()).forEach((description) => {
        const item = document.createElement("li");
        item.textContent = description;
        variables.appendChild(item);
      });
      const formula = document.createElement("p");
      formula.className = "legend-formula";
      formula.textContent = "Formula: For each selected variable, min–max normalize its block-group values to 0–1: (value − minimum) ÷ (maximum − minimum). Then calculate the arithmetic mean of the normalized variables, giving each variable equal weight. If a variable has the same value in every block group, its normalized value is 0.5.";
      els.legendDescription.append(variablesTitle, variables, formula);
    } else if (isOrdinalMode()) {
      els.legendDescription.hidden = false;
      const scoreLabels = activeLodesCategory === "earnings"
        ? "Earnings: $1,250/month or less = 1; $1,251–$3,333 = 2; more than $3,333 = 3."
        : activeLodesCategory === "education"
          ? "Education: less than high school = 1; high school or equivalent = 2; some college or associate degree = 3; bachelor's degree or advanced degree = 4."
          : "Age: youngest group = 1; ages 30–54 = 2; oldest group = 3.";
      els.legendDescription.textContent = "Weighted average of the selected category scores, with each score weighted by its job count. " + scoreLabels + " This is an ordinal index, not a dollar amount, age, or education average.";
    } else if (isNominalMode()) {
      els.legendDescription.hidden = false;
      const selected = nominalSelectedCodes();
      els.legendDescription.textContent = selected.length > 1
        ? "Each block group is colored by the selected subcategory with the greatest count. Colors identify categories; they do not represent category percentages."
        : "The map shows the selected subcategory as a percentage of the relevant total in each block group.";
    }
    els.legend.replaceChildren();
    if (meta.categorical) {
      const selected = nominalSelectedCodes();
      selected.forEach((code) => {
        const row = document.createElement("div");
        row.className = "legend-row";
        const swatch = document.createElement("span");
        swatch.className = "legend-swatch";
        swatch.style.backgroundColor = nominalCategoryColor(code);
        const label = document.createElement("span");
        label.textContent = DETAIL_LABELS[code] || optionLabel(code);
        row.append(swatch, label);
        els.legend.appendChild(row);
      });
      const missing = document.createElement("div");
      missing.className = "legend-row";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = "#d8dcd8";
      const label = document.createElement("span");
      label.textContent = "No data / unmatched";
      missing.append(swatch, label);
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

  const GRAPH_OPTIONS = {
    single: [
      ["distribution", "Distribution histogram"],
      ["benchmark", "County benchmark chart"]
    ],
    combined: [
      ["contribution", "Component contribution chart"],
      ["comparison", "Variable comparison chart"],
      ["index-distribution", "Index distribution histogram"],
      ["correlation", "Component correlation matrix"]
    ]
  };
  function graphElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function graphRows() {
    return baseFeatures.map((feature) => ({ feature, value: getValue(feature) }))
      .filter((item) => item.value !== null && Number.isFinite(item.value));
  }
  function graphFeatureLabel(feature) {
    const p = feature.properties || {};
    return p.NAMELSAD || ("Block Group " + selectedFeatureId(feature).slice(-1));
  }
  function graphBar(container, label, value, max, detail, color) {
    const row = graphElement("div", "map-graph-bar-row");
    const name = graphElement("span", "map-graph-label", label);
    const track = graphElement("span", "map-graph-track");
    const fill = graphElement("span", "map-graph-fill");
    fill.style.width = (max > 0 ? Math.max(0, value / max * 100) : 0) + "%";
    fill.style.backgroundColor = color || "var(--accent)";
    track.appendChild(fill);
    row.append(name, track, graphElement("strong", "map-graph-value", detail));
    container.appendChild(row);
  }
  function renderHistogram(host, rows, selectedValue, label) {
    if (rows.length < 2) return false;
    const min = Math.min(...rows.map((r) => r.value)), max = Math.max(...rows.map((r) => r.value));
    const bins = Array.from({length:8}, (_,i)=>({label:"",count:0,low:min+(max-min)*i/8,high:min+(max-min)*(i+1)/8}));
    rows.forEach(({value}) => {
      const index = max === min ? 0 : Math.min(7, Math.floor((value-min)/(max-min)*8));
      bins[index].count += 1;
    });
    const chart = graphElement("div","map-histogram");
    const peak = Math.max(...bins.map((b)=>b.count),1);
    bins.forEach((bin,i)=>{
      const col=graphElement("div","map-histogram-bin");
      const count=graphElement("strong","",String(bin.count));
      const bar=graphElement("span","map-histogram-bar");
      bar.style.height=(bin.count/peak*100)+"%";
      if(selectedValue!==null && selectedValue>=bin.low && (selectedValue<bin.high || i===7)) bar.classList.add("is-selected");
      const range=graphElement("small","",formatValue(bin.low)+"–"+formatValue(bin.high));
      col.append(count,bar,range); chart.appendChild(col);
    });
    host.appendChild(chart);
    host.appendChild(graphElement("p","map-graph-note",label + (selectedValue===null ? "" : " · Selected block group is highlighted")));
    return true;
  }
  function normalizedColumns(keys) {
    return keys.map((key)=>{
      const values=baseFeatures.map((feature)=>measureValueForKey(feature,key));
      const valid=values.filter((v)=>v!==null);
      if(!valid.length) return {key,values,normalized:values.map(()=>null)};
      const min=Math.min(...valid), max=Math.max(...valid);
      return {key,values,normalized:values.map(v=>v===null?null:(max===min?0.5:(v-min)/(max-min)))};
    });
  }
  function correlation(a,b) {
    const pairs=a.map((v,i)=>[v,b[i]]).filter(p=>p[0]!==null&&p[1]!==null);
    if(pairs.length<3) return null;
    const mx=pairs.reduce((s,p)=>s+p[0],0)/pairs.length, my=pairs.reduce((s,p)=>s+p[1],0)/pairs.length;
    const cov=pairs.reduce((s,p)=>s+(p[0]-mx)*(p[1]-my),0);
    const dx=Math.sqrt(pairs.reduce((s,p)=>s+(p[0]-mx)**2,0)), dy=Math.sqrt(pairs.reduce((s,p)=>s+(p[1]-my)**2,0));
    return dx&&dy?cov/(dx*dy):null;
  }
  function renderMapGraph() {
    if (!els.graphSection || !els.graphSelect || !els.graph) return;
    const options=GRAPH_OPTIONS[mapMode];
    const previous=els.graphSelect.value;
    els.graphSelect.replaceChildren();
    options.forEach(([value,label])=>els.graphSelect.add(new Option(label,value)));
    const selectedKeys=selectedMeasureKeys();
    const applicable=options.filter(([key])=>{
      if(key==="benchmark") return Boolean(selectedFeature);
      if(key==="correlation") return selectedKeys.length>=2;
      return true;
    });
    if (!applicable.length || (mapMode==="combined" && compositeError)) { els.graphSection.hidden=true; return; }
    els.graphSection.hidden=false;
    if (applicable.some(([key])=>key===previous)) els.graphSelect.value=previous;
    else els.graphSelect.value=applicable[0][0];
    Array.from(els.graphSelect.options).forEach(option=>{
      option.hidden=!applicable.some(([key])=>key===option.value);
    });
    const type=els.graphSelect.value;
    const host=els.graph; host.replaceChildren();
    const selectedValue=selectedFeature?getValue(selectedFeature):null;
    if (type==="distribution" || type==="index-distribution") {
      const rows=graphRows();
      const title=type==="distribution"?"Block-group distribution":"Combined index distribution";
      host.appendChild(graphElement("p","map-graph-subtitle",title+" · "+rows.length+" block groups"));
      if(!renderHistogram(host,rows,selectedValue,"Countywide distribution")) host.textContent="Not enough valid block-group values to plot this distribution.";
    } else if(type==="benchmark") {
      if(!selectedFeature) { host.textContent="Select one block group to compare it with the countywide block-group average."; return; }
      const rows=graphRows(), avg=rows.length?rows.reduce((s,r)=>s+r.value,0)/rows.length:null;
      const value=selectedValue;
      host.appendChild(graphElement("p","map-graph-subtitle",graphFeatureLabel(selectedFeature)+" compared with the mean across block groups"));
      if(value===null || avg===null) { host.textContent="The selected block group does not have a usable value for this measure."; return; }
      const max=Math.max(value,avg,1);
      graphBar(host,"Selected block group",value,max,formatValue(value),"#b58a4b");
      graphBar(host,"Countywide BG mean",avg,max,formatValue(avg));
      host.appendChild(graphElement("p","map-graph-note","The benchmark is the arithmetic mean of available block-group values, not a separately published county estimate."));
    } else {
      const keys=selectedMeasureKeys(), cols=normalizedColumns(keys);
      if(!cols.length || compositeError) { host.textContent=compositeError||"Select measures to calculate this graph."; return; }
      const featureIndex=selectedFeature?baseFeatures.findIndex(f=>selectedFeatureId(f)===selectedFeatureId(selectedFeature)):-1;
      const averages=cols.map(col=>{const v=col.normalized.filter(x=>x!==null);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;});
      if(type==="contribution" || type==="comparison") {
        const title=selectedFeature?graphFeatureLabel(selectedFeature):"Countywide block-group mean";
        host.appendChild(graphElement("p","map-graph-subtitle",title+" · normalized component scores"));
        cols.forEach((col,i)=>{
          const value=selectedFeature?col.normalized[featureIndex]:averages[i];
          if(value===null) return;
          const avg=averages[i]??0;
          graphBar(host,measureLabel(col.key),value,1,Math.round(value*100)+"%",type==="contribution"?"#b58a4b":undefined);
          if(type==="comparison") host.appendChild(graphElement("p","map-graph-note","Countywide mean: "+formatValue(avg*100)+"%"));
        });
        host.appendChild(graphElement("p","map-graph-note",type==="contribution"?"Each component has equal weight in the index; bars show its normalized score, not a different weighting.":"Values are min–max normalized across block groups; countywide mean is shown below each component."));
      } else if(type==="correlation") {
        if(cols.length<2) { host.textContent="Select at least two measures to calculate component correlations."; return; }
        const table=graphElement("table","map-correlation-table");
        const head=graphElement("tr"); head.appendChild(graphElement("th","", "Component"));
        cols.forEach(col=>head.appendChild(graphElement("th","",measureLabel(col.key))));
        const thead=graphElement("thead"); thead.appendChild(head); table.appendChild(thead);
        const body=graphElement("tbody");
        cols.forEach((col,i)=>{
          const tr=graphElement("tr"); tr.appendChild(graphElement("th","",measureLabel(col.key)));
          cols.forEach((other,j)=>{
            const r=correlation(col.values,other.values);
            const td=graphElement("td",r===null?"is-missing":r>=0.6?"is-positive":r<=-0.6?"is-negative":"",r===null?"—":r.toFixed(2));
            tr.appendChild(td);
          });
          body.appendChild(tr);
        });
        table.appendChild(body); host.appendChild(table);
        host.appendChild(graphElement("p","map-graph-note","Pearson correlation across block groups; association does not imply causation."));
      }
    }
  }
  els.graphSelect?.addEventListener("change",renderMapGraph);

  function sharedScaleValues() {
    if (mapMode !== "single") return baseFeatures.map(getValue).filter((value) => value !== null);
    const years = selectedYears(activeMode === "jobs" ? els.lodesYear : els.acsYear);
    if (years.length < 2) return baseFeatures.map(getValue).filter((value) => value !== null);
    const values = [];
    if (activeMode === "jobs") {
      const original = selectedYearData;
      years.forEach((year) => {
        const data = lodesDataByYear.get(year);
        if (!data) return;
        selectedYearData = data;
        baseFeatures.forEach((feature) => { const value = getSingleValue(feature); if (value !== null) values.push(value); });
      });
      selectedYearData = original;
    } else {
      const originals = baseFeatures.map((feature) => feature.properties);
      years.forEach((year) => {
        const data = acsDataByYear.get(year);
        if (!data) return;
        baseFeatures.forEach((feature) => {
          const id = String((feature.properties || {}).GEOID || "");
          const row = data.get(id);
          if (row) feature.properties = { ...feature.properties, ...row };
          const value = getSingleValue(feature);
          if (value !== null) values.push(value);
        });
        baseFeatures.forEach((feature, index) => { feature.properties = originals[index]; });
      });
    }
    return values;
  }
  function refreshMap() {
    if (!geojsonLayer) return;
    if (mapMode === "combined") calculateCompositeValues();
    else { compositeValues = new Map(); compositeError = ""; }
    updatePrimaryYearOptions();
    const categoricalMode = isNominalMode() && nominalSelectedCodes().length > 1;
    currentBreaks = categoricalMode ? [] : quantileBreaks(sharedScaleValues());
    geojsonLayer.setStyle(styleFeature);
    updateLegend();
    if (els.period) {
      els.period.textContent = mapMode === "combined"
        ? "Combined index · LODES " + els.lodesYear.value + " + ACS " + els.acsYear.value
        : (activeMode === "jobs" ? "LODES · " + activeDisplayYear : "ACS · " + activeDisplayYear + " five-year");
    }
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
    renderDataPanel();
    renderMapGraph();
  }
  async function loadLodesYear(year) {
    const key = String(year);
    if (lodesDataByYear.has(key)) return lodesDataByYear.get(key);
    els.status.textContent = "Loading employment data for " + year + "…";
    const response = await fetch(LODES_PATH(year));
    if (!response.ok) throw new Error("Could not load LODES characteristics for " + year + " (HTTP " + response.status + ").");
    const rows = parseCsv(await response.text());
    const yearData = new Map(rows.map((row) => [String(row.GEOID), row]));
    lodesDataByYear.set(key, yearData);
    const unavailable = Number(year) < 2009;
    if (key === activeDisplayYear) {
      selectedYearData = yearData;
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
    }
    return yearData;
  }
  async function loadAcsYears(years) {
    await Promise.all(years.map(async (year) => {
      const key = String(year);
      if (acsDataByYear.has(key)) return;
      const response = await fetch(ACS_BG_PATH(key));
      if (!response.ok) throw new Error("Could not load ACS block-group estimates for " + key + " (HTTP " + response.status + ").");
      const rows = parseCsv(await response.text());
      acsDataByYear.set(key, new Map(rows.map((row) => [String(row.GEOID), row])));
    }));
  }
  async function applyAcsYear(year) {
    const key = String(year);
    const data = acsDataByYear.get(key);
    if (!data) throw new Error("ACS " + key + " has not been loaded.");
    baseFeatures.forEach((feature) => {
      const id = String((feature.properties || {}).GEOID || "");
      const row = data.get(id);
      if (row) feature.properties = { ...feature.properties, ...row };
    });
    const response = await fetch(ACS_COUNTY_PATH(key));
    if (!response.ok) throw new Error("Could not load county ACS estimates for " + key + " (HTTP " + response.status + ").");
    countyAcsData = parseCsv(await response.text())[0] || null;
    if (!countyAcsData) throw new Error("County ACS " + key + " file contains no data row.");
    activeDisplayYear = key;
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
          activeDisplayYear = ensureDisplayYear(els.acsYear, activeDisplayYear);
          acsSelections[category] = items().filter((item) => item.checked).map((item) => item.value);
          items().forEach((item) => { item.disabled = false; });
          setAcsFields(category, acsSelections[category]);
          loadAcsYears(selectedYears(els.acsYear)).then(() => applyAcsYear(activeDisplayYear)).then(refreshMap).catch(showError);
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
    activeDisplayYear = ensureDisplayYear(els.acsYear, activeDisplayYear);
    loadAcsYears(selectedYears(els.acsYear))
      .then(() => applyAcsYear(activeDisplayYear))
      .then(refreshMap)
      .catch(showError);
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
  els.lodesYear.addEventListener("change", () => {
    const years = selectedYears(els.lodesYear);
    const displayYear = ensureDisplayYear(els.lodesYear, years.includes(activeDisplayYear) ? activeDisplayYear : null);
    Promise.all(years.map(loadLodesYear)).then(() => {
      selectedYearData = lodesDataByYear.get(displayYear) || new Map();
      if (activeMode === "jobs") activeDisplayYear = displayYear;
      updatePrimaryYearOptions(); refreshMap();
    }).catch(showError);
  });
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
      activeDisplayYear = ensureDisplayYear(els.acsYear, activeDisplayYear);
      loadAcsYears(selectedYears(els.acsYear)).then(() => applyAcsYear(activeDisplayYear)).then(refreshMap).catch(showError);
      syncAcsActiveCategory(category);
      const categoryInput = document.querySelector('[data-category="' + category + '"]');
      if (categoryInput && !categoryInput.checked) categoryInput.checked = true;
      updatePrimaryOptions();
      setPrimaryContext(els.primaryMeasure.value);
      refreshMap();
    });
  });
  els.acsYear.addEventListener("change", () => {
    activeDisplayYear = ensureDisplayYear(els.acsYear, activeDisplayYear);
    loadAcsYears(selectedYears(els.acsYear)).then(() => applyAcsYear(activeDisplayYear)).then(() => {
      updatePrimaryYearOptions(); refreshMap();
    }).catch(showError);
  });
  els.primaryYear?.addEventListener("change", () => {
    activeDisplayYear = els.primaryYear.value;
    if (activeMode === "jobs") {
      selectedYearData = lodesDataByYear.get(activeDisplayYear) || new Map();
      refreshMap();
    } else {
      applyAcsYear(activeDisplayYear).then(refreshMap).catch(showError);
    }
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
      map.zoomIn();

      // The outside mask is an optional visual layer. Its absence must not
      // prevent the block-group map or the data summary from loading.
      fetch("data/2023/flathead_outside_county_mask.geojson")
        .then((response) => response.ok ? response.json() : null)
        .then((mask) => {
          if (!mask) return;
          L.geoJSON(mask, {
            style: {
              stroke: false,
              fillColor: "#777b7b",
              fillOpacity: 0.48
            },
            interactive: false
          }).addTo(map);
        })
        .catch((error) => console.warn("Outside-county mask unavailable:", error));

      return Promise.all([
        Promise.all(selectedYears(els.lodesYear).map(loadLodesYear)),
        loadAcsYears(selectedYears(els.acsYear))
      ]).then(async () => {
        activeDisplayYear = "2023";
        selectedYearData = lodesDataByYear.get(activeDisplayYear) || new Map();
        await applyAcsYear("2024");
        updatePrimaryYearOptions();
        refreshMap();
        renderDataPanel();
      });
    })
    .catch(showError);
})();

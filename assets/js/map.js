/* Map behavior and data loading. Visual design belongs in assets/css/map.css. */
(() => {
  "use strict";

  const GEOJSON_URL = "data/2023/flathead_economic_2023.geojson";
  const LODES_PATH = (year) => `data/lodes/${year}/flathead_lodes_jobs_by_block_group.csv`;
  const LODES_YEARS = Array.from({ length: 22 }, (_, i) => 2002 + i);
  const ACS_FIELDS = {
    B01001_001E: { label: "Total population", format: "number" },
    B19013_001E: { label: "Median household income", format: "currency" },
    B19301_001E: { label: "Per capita income", format: "currency" },
    B17001_002E: { label: "Population below poverty level", format: "number" },
    B23025_004E: { label: "Employed population", format: "number" }
  };
  const JOB_FIELDS = {
    wac_jobs: { label: "Jobs by workplace", format: "number" },
    rac_jobs: { label: "Jobs by worker residence", format: "number" }
  };
  const COLORS = ["#f2f3ed", "#d4e2d7", "#a9c9b3", "#76a489", "#477b61", "#24513c"];

  const els = {
    dataset: document.querySelector("#dataset-select"),
    measure: document.querySelector("#measure-select"),
    year: document.querySelector("#year-select"),
    yearControl: document.querySelector("#year-control"),
    acsControl: document.querySelector("#acs-control"),
    acsMeasure: document.querySelector("#acs-measure-select"),
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

  LODES_YEARS.slice().reverse().forEach((year) => {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    els.year.appendChild(option);
  });
  els.year.value = "2023";

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
    return type === "currency"
      ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n)
      : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
  };
  const activeField = () => activeMode === "jobs" ? els.measure.value : els.acsMeasure.value;
  const activeMeta = () => activeMode === "jobs" ? JOB_FIELDS[activeField()] : ACS_FIELDS[activeField()];
  const getValue = (feature) => {
    const id = String(feature.properties.GEOID ?? feature.properties.GEOIDFQ ?? "");
    if (activeMode === "jobs") {
      const row = selectedYearData.get(id);
      return row ? numeric(row[activeField()]) : null;
    }
    return numeric(feature.properties[activeField()]);
  };
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
    const values = baseFeatures.map(getValue).filter((value) => value !== null);
    const breaks = quantileBreaks(values);
    return {
      fillColor: colorFor(getValue(feature), breaks),
      weight: 1,
      opacity: 1,
      color: "#ffffff",
      dashArray: "",
      fillOpacity: 0.82
    };
  }

  function popupContent(feature) {
    const p = feature.properties;
    const title = p.NAMELSAD || p.NAME || p.GEOID || "Census block group";
    const currentMeta = activeMeta();
    const currentValue = getValue(feature);
    const lines = [
      [currentMeta.label, formatValue(currentValue, currentMeta.format)],
      ["Geographic ID", p.GEOID || "Not available"]
    ];
    if (activeMode === "jobs") {
      const row = selectedYearData.get(String(p.GEOID || ""));
      if (row) {
        lines.push(["Jobs by workplace", formatValue(numeric(row.wac_jobs))]);
        lines.push(["Jobs by worker residence", formatValue(numeric(row.rac_jobs))]);
      }
      lines.push(["Source", `LODES ${els.year.value}`]);
    } else {
      lines.push(["ACS estimate", "2024 five-year"]);
    }
    return `<div class="popup-card"><h3 class="popup-title">${escapeHtml(title)}</h3>${lines.map(([label, value]) => `<div class="popup-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>`;
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  }
  function onEachFeature(feature, layer) {
    layer.bindPopup(() => popupContent(feature));
    layer.on({
      mouseover: (event) => event.target.setStyle({ weight: 2.5, color: "#1c3328", fillOpacity: 0.95 }),
      mouseout: (event) => { if (geojsonLayer) geojsonLayer.resetStyle(event.target); }
    });
  }

  function updateLegend() {
    const values = baseFeatures.map(getValue).filter((value) => value !== null);
    const breaks = quantileBreaks(values);
    const meta = activeMeta();
    els.legendTitle.textContent = meta.label;
    els.legend.replaceChildren();
    if (!breaks.length) {
      els.legend.textContent = "No values available for this selection.";
      return;
    }
    let previous = null;
    breaks.forEach((limit, i) => {
      const row = document.createElement("div");
      row.className = "legend-row";
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.backgroundColor = COLORS[i + 1];
      const range = document.createElement("span");
      range.textContent = i === 0 ? `Up to ${formatValue(limit, meta.format)}` : `${formatValue(previous, meta.format)} – ${formatValue(limit, meta.format)}`;
      const value = document.createElement("span");
      value.className = "legend-value";
      value.textContent = `Q${i + 1}`;
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
    geojsonLayer.setStyle(styleFeature);
    updateLegend();
    els.period.textContent = activeMode === "jobs" ? `LODES · ${els.year.value}` : "ACS · 2024 five-year";
    els.status.textContent = `${baseFeatures.length} block groups · ${baseFeatures.filter((f) => getValue(f) !== null).length} with data`;
    geojsonLayer.eachLayer((layer) => {
      if (layer.isPopupOpen()) layer.setPopupContent(popupContent(layer.feature));
    });
  }

  async function loadJobsYear(year) {
    els.status.textContent = `Loading employment data for ${year}…`;
    const response = await fetch(LODES_PATH(year));
    if (!response.ok) throw new Error(`Could not load LODES data for ${year} (HTTP ${response.status}).`);
    const rows = parseCsv(await response.text());
    selectedYearData = new Map(rows.map((row) => [String(row.GEOID), row]));
    refreshMap();
  }

  function updateModeControls() {
    activeMode = els.dataset.value;
    const isJobs = activeMode === "jobs";
    els.yearControl.hidden = !isJobs;
    els.measure.closest("label")?.remove();
    els.measure.hidden = !isJobs;
    const measureLabel = document.querySelector('label[for="measure-select"]');
    if (measureLabel) measureLabel.hidden = !isJobs;
    els.acsControl.hidden = isJobs;
    if (isJobs) {
      els.measure.value = els.measure.value || "wac_jobs";
      loadJobsYear(els.year.value).catch(showError);
    } else {
      refreshMap();
    }
  }
  function showError(error) {
    console.error(error);
    els.status.textContent = `Data could not be loaded: ${error.message}`;
  }

  fetch(GEOJSON_URL)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load block-group GeoJSON (HTTP ${response.status}).`);
      return response.json();
    })
    .then((geojson) => {
      baseFeatures = geojson.features || [];
      if (!baseFeatures.length) throw new Error("The GeoJSON file contains no map features.");
      geojsonLayer = L.geoJSON(geojson, { style: styleFeature, onEachFeature }).addTo(map);
      map.fitBounds(geojsonLayer.getBounds(), { padding: [18, 18] });
      return loadJobsYear(els.year.value);
    })
    .catch(showError);

  els.dataset.addEventListener("change", updateModeControls);
  els.measure.addEventListener("change", () => activeMode === "jobs" && loadJobsYear(els.year.value).catch(showError));
  els.year.addEventListener("change", () => activeMode === "jobs" && loadJobsYear(els.year.value).catch(showError));
  els.acsMeasure.addEventListener("change", refreshMap);
})();

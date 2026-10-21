import { loadBlockGroups, loadLodesYear } from "./data.js";
import { initializeMap, setData } from "./map.js";
import { initializeControls } from "./controls.js";

const status = document.getElementById("data-status");
const selectedArea = document.getElementById("selected-area");
const selectedValue = document.getElementById("selected-value");
const selectedGeoid = document.getElementById("selected-geoid");

let mapController;
let latestValues = new Map();
let currentYear = 2023;
let currentMetric = "rac_jobs";

function formatNumber(value) {
  return value == null || !Number.isFinite(value) ? "No data" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function updateSelection(geoid, label, values) {
  selectedArea.textContent = label || "Census block group";
  selectedGeoid.textContent = geoid || "—";
  selectedValue.textContent = formatNumber(values?.[currentMetric]);
}

async function updateData(year, metric) {
  currentYear = year;
  currentMetric = metric;
  status.textContent = `Loading ${year} data…`;
  document.getElementById("year-select").disabled = true;
  document.getElementById("metric-select").disabled = true;
  try {
    latestValues = await loadLodesYear(year);
    setData(latestValues, year, metric);
    selectedArea.textContent = "Choose a block group";
    selectedGeoid.textContent = "—";
    selectedValue.textContent = "—";
    status.textContent = `${year} data loaded · ${latestValues.size} block groups`;
  } catch (error) {
    status.textContent = error.message || "Could not load data.";
    console.error(error);
  } finally {
    document.getElementById("year-select").disabled = false;
    document.getElementById("metric-select").disabled = false;
  }
}

async function start() {
  try {
    status.textContent = "Loading block-group geography…";
    const geography = await loadBlockGroups();
    mapController = initializeMap(geography, (geoid, label, values) => updateSelection(geoid, label, values));
    initializeControls({
      onChange: updateData,
      onReset: () => mapController.resetView()
    });
    await updateData(currentYear, currentMetric);
  } catch (error) {
    status.textContent = error.message || "The map could not be initialized.";
    console.error(error);
  }
}

start();

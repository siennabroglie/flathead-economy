import { AVAILABLE_LODES_YEARS } from "./data.js";

export function initializeControls({ onChange, onReset }) {
  const yearSelect = document.getElementById("year-select");
  const metricSelect = document.getElementById("metric-select");
  const resetButton = document.getElementById("reset-map");
  for (const year of [...AVAILABLE_LODES_YEARS].reverse()) {
    const option = document.createElement("option");
    option.value = String(year);
    option.textContent = String(year);
    yearSelect.append(option);
  }
  yearSelect.value = "2023";
  yearSelect.addEventListener("change", () => onChange(Number(yearSelect.value), metricSelect.value));
  metricSelect.addEventListener("change", () => onChange(Number(yearSelect.value), metricSelect.value));
  resetButton.addEventListener("click", onReset);
  return { setYear: year => { yearSelect.value = String(year); } };
}

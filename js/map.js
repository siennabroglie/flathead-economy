import { getFeatureGeoid, getFeatureLabel } from "./data.js";

const COLORS = ["var(--color-map-low)", "var(--color-map-mid-low)", "var(--color-map-mid)", "var(--color-map-mid-high)", "var(--color-map-high)"];
const NO_DATA = "var(--color-no-data)";
let map;
let geojsonLayer;
let initialBounds;
let currentFeatures = [];
let currentValues = new Map();
let currentMetric = "rac_jobs";
let currentYear = 2023;
let onFeatureSelect = () => {};

function colorFor(value, thresholds) {
  if (value == null || !Number.isFinite(value)) return NO_DATA;
  if (value <= thresholds[0]) return COLORS[0];
  if (value <= thresholds[1]) return COLORS[1];
  if (value <= thresholds[2]) return COLORS[2];
  if (value <= thresholds[3]) return COLORS[3];
  return COLORS[4];
}

function buildThresholds(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return [0, 0, 0, 0];
  return [0.2, 0.4, 0.6, 0.8].map(q => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]);
}

export function initializeMap(geojson, selectCallback) {
  onFeatureSelect = selectCallback;
  currentFeatures = geojson.features;
  map = L.map("map", { zoomControl: true, scrollWheelZoom: true });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19
  }).addTo(map);
  geojsonLayer = L.geoJSON(geojson, { style: () => ({ color: "#fffefa", weight: 1, opacity: 0.9, fillOpacity: 0.82, fillColor: NO_DATA }), onEachFeature: bindFeature }).addTo(map);
  initialBounds = geojsonLayer.getBounds();
  if (initialBounds.isValid()) map.fitBounds(initialBounds, { padding: [18, 18] });
  return { setData, resetView: () => { if (initialBounds?.isValid()) map.fitBounds(initialBounds, { padding: [18, 18] }); } };
}

function bindFeature(feature, layer) {
  layer.on({
    mouseover: event => event.target.setStyle({ weight: 2.5, color: "#202a27", fillOpacity: 0.98 }),
    mouseout: () => geojsonLayer.resetStyle(layer),
    click: () => onFeatureSelect(getFeatureGeoid(feature), getFeatureLabel(feature), currentValues.get(getFeatureGeoid(feature)) ?? null)
  });
}

export function setData(values, year, metric) {
  currentValues = values;
  currentYear = Number(year);
  currentMetric = metric;
  const valid = currentFeatures.map(feature => values.get(getFeatureGeoid(feature))?.[metric]).filter(Number.isFinite);
  const thresholds = buildThresholds(valid);
  geojsonLayer.setStyle(feature => {
    const value = values.get(getFeatureGeoid(feature))?.[metric] ?? null;
    return { fillColor: colorFor(value, thresholds), color: "#fffefa", weight: 1, opacity: 0.9, fillOpacity: 0.84 };
  });
  updateLegend(thresholds, valid);
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function updateLegend(thresholds, values) {
  const legend = document.getElementById("map-legend");
  if (!legend) return;
  if (!values.length) {
    legend.innerHTML = "<span>No numeric values available.</span>";
    return;
  }
  const labels = [
    `≤ ${formatNumber(thresholds[0])}`,
    `${formatNumber(thresholds[0])}–${formatNumber(thresholds[1])}`,
    `${formatNumber(thresholds[1])}–${formatNumber(thresholds[2])}`,
    `${formatNumber(thresholds[2])}–${formatNumber(thresholds[3])}`,
    `> ${formatNumber(thresholds[3])}`
  ];
  legend.innerHTML = COLORS.map((color, i) => `<div class="legend-row"><span class="legend-swatch" style="background:${color}"></span><span>${labels[i]}</span></div>`).join("") +
    `<div class="legend-row"><span class="legend-swatch" style="background:${NO_DATA}"></span><span>Missing data</span></div>`;
}

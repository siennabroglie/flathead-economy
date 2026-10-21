# Map interface and visual customization

The first map interface lives at the repository root and is designed to work with GitHub Pages.

## Where to change the appearance

Edit **[`assets/css/map.css`](../assets/css/map.css)**. Map behavior and data loading are kept separately in `assets/js/map.js`, so routine visual changes should not require JavaScript edits.

Start with the `:root` variables near the top of `map.css`:

- `--page-bg`, `--surface`, and `--surface-muted`: page and panel backgrounds
- `--text` and `--text-muted`: typography colors
- `--accent`, `--accent-strong`, and `--accent-soft`: interface accent colors
- `--border` and `--shadow`: panel borders and depth
- `--radius-panel` and `--radius-control`: corner shapes
- `--font-body` and `--font-heading`: typography
- `--map-height`: default map height
- `--panel-padding` and `--content-gap`: spacing

The choropleth palette is currently defined in `assets/js/map.js` as `COLORS`; the map's interface and layout are in the CSS stylesheet. If you want the data colors to be customizable through CSS as well, the next refinement can move the choropleth palette into CSS variables.

## Current prototype behavior

- Loads the 2023 block-group GeoJSON as the geographic base.
- Provides LODES jobs by workplace / worker residence for 2002–2023.
- Provides selected 2024 ACS five-year demographic and economic measures.
- Shows a legend and a popup when a block group is selected.
- Uses separate data selectors because ACS and LODES represent different data products and time periods.

The ACS values are estimates for the 2024 five-year period, not yearly observations. LODES annual job counts are available through 2023 in this repository. Blank LODES values remain missing and are shown with a neutral map color, rather than being treated as zero.

## Notes

This is an initial interface, not a finished public-facing analytical product. Validate the map and its data in GitHub Pages before relying on the displayed values. Leaflet and OpenStreetMap tiles are loaded from their public CDN / tile service, so viewing the map requires an internet connection.

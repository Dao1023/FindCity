import "./style.css";
import L from "leaflet";
import {
  loadCities,
  loadCountries,
  pointName,
  pointRank,
  pointSub,
  type Granularity,
  type Metric,
  type Point,
} from "./data.ts";
import {
  createLayers,
  setView,
  type ViewMode,
  type LayerState,
} from "./layers.ts";
import {
  createTooltip,
  showTooltip,
  hideTooltip,
  renderRail,
  highlightRailItem,
  wireToggle,
  type RailElements,
} from "./ui.ts";

async function main() {
  // Load both granularities up front so toggling is instant.
  const [cities, countries] = await Promise.all([loadCities(), loadCountries()]);
  console.log(`Loaded ${cities.length} cities, ${countries.length} countries`);

  // Initialize the dark map.
  const map = L.map("map", {
    center: [25, 15],
    zoom: 2,
    minZoom: 2,
    maxZoom: 9,
    zoomControl: true,
    worldCopyJump: true,
    attributionControl: true,
    preferCanvas: false,
  });

  // CartoDB Dark Matter — no labels, deep dark base.
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · © <a href="https://carto.com/attributions">CARTO</a> · Data: Nature Index, ROR',
      subdomains: "abcd",
      maxZoom: 19,
    }
  ).addTo(map);

  // Subtle labels layer on top, dimmed.
  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png",
    {
      subdomains: "abcd",
      maxZoom: 19,
      opacity: 0.55,
    }
  ).addTo(map);

  // UI elements.
  const tooltip = createTooltip();
  const rail: RailElements = {
    list: document.getElementById("rail-list") as HTMLOListElement,
    metricLabel: document.getElementById("rail-metric") as HTMLSpanElement,
    headLabel: document.getElementById("rail-head") as HTMLSpanElement,
  };
  const hoverValue = document.getElementById("hover-city") as HTMLSpanElement;
  const cityCount = document.getElementById("city-count") as HTMLSpanElement;
  cityCount.textContent = cities.length.toLocaleString("en-US");

  // State.
  let metric: Metric = "share";
  let view: ViewMode = "bubbles";
  let granularity: Granularity = "city";
  let layerState: LayerState = createLayers(map);

  const points = (): Point[] =>
    granularity === "city" ? (cities as Point[]) : (countries as Point[]);

  const onHover = (p: Point | null, evt: MouseEvent) => {
    if (p && evt) {
      showTooltip(tooltip, p, evt, metric);
      hoverValue.textContent =
        `${pointName(p)}${pointSub(p) ? " · " + pointSub(p) : ""} · ` +
        `share ${Math.round(p.share)} count ${p.count}`;
      highlightRailItem(rail, pointRank(p, metric));
    } else {
      hideTooltip(tooltip);
      hoverValue.textContent = "— move over a point —";
      highlightRailItem(rail, null);
    }
  };

  const flyTo = (p: Point) => {
    const zoom = map.getZoom() < 5 ? 6 : map.getZoom();
    map.flyTo([p.lat, p.lng], zoom, { duration: 1.1 });
    hoverValue.textContent =
      `${pointName(p)}${pointSub(p) ? " · " + pointSub(p) : ""} · ` +
      `share ${Math.round(p.share)} count ${p.count}`;
  };

  const refresh = () => {
    setView(map, layerState, view, metric, points(), onHover, flyTo);
    renderRail(rail, points(), metric, granularity, flyTo);
  };

  // Wire toggles.
  wireToggle("metric-toggle", metric, (v) => {
    metric = v as Metric;
    refresh();
  });
  wireToggle("view-toggle", view, (v) => {
    view = v as ViewMode;
    refresh();
  });
  wireToggle("gran-toggle", granularity, (v) => {
    granularity = v as Granularity;
    refresh();
  });

  // Initial render — wait a beat so tiles paint first.
  refresh();

  // Update tooltip position on mouse move while a point is hovered.
  document.addEventListener("mousemove", (e) => {
    if (tooltip.root.classList.contains("visible")) {
      const pad = 16;
      const w = tooltip.root.offsetWidth || 260;
      const h = tooltip.root.offsetHeight || 200;
      let x = e.clientX + pad;
      let y = e.clientY + pad;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
      tooltip.root.style.left = `${Math.max(8, x)}px`;
      tooltip.root.style.top = `${Math.max(8, y)}px`;
    }
  });
}

main().catch((e) => {
  console.error(e);
  const app = document.getElementById("app");
  if (app) {
    const err = document.createElement("div");
    err.style.cssText =
      "position:absolute;inset:0;display:grid;place-items:center;color:#c5bca7;font-family:monospace;text-align:center;padding:20px;";
    err.innerHTML = `<div><div style="font-size:48px;color:#f5b342;margin-bottom:12px;">✦</div>Failed to load atlas data.<br/><span style="color:#756e5d;font-size:12px;">${String(
      e.message ?? e
    )}</span></div>`;
    app.appendChild(err);
  }
});

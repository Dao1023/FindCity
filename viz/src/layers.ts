import L from "leaflet";
import "leaflet.heat";
import type { City, Metric } from "./data.ts";

export type ViewMode = "bubbles" | "heat";

interface LayerState {
  bubbles: L.LayerGroup;
  heat: L.Layer | null;
  markers: Map<number, L.Marker>; // city.rank -> marker
}

export function createLayers(map: L.Map): LayerState {
  const bubbles = L.layerGroup().addTo(map);
  return { bubbles, heat: null, markers: new Map() };
}

function maxValue(cities: City[], metric: Metric): number {
  let m = 0;
  for (const c of cities) if (c[metric] > m) m = c[metric];
  return m || 1;
}

// Bubble radius in px: sqrt-scaled relative to current metric's max, clamped.
export function bubbleRadius(value: number, max: number): number {
  if (value <= 0) return 0;
  const r = 2 + 38 * Math.sqrt(value / max);
  return Math.max(2, Math.min(42, r));
}

// Build / rebuild the bubble layer for a given metric.
export function renderBubbles(
  map: L.Map,
  state: LayerState,
  cities: City[],
  metric: Metric,
  onHover: (city: City | null, evt: MouseEvent) => void,
  onClick: (city: City) => void
) {
  state.bubbles.clearLayers();
  state.markers.clear();

  const max = maxValue(cities, metric);
  // Show all cities that have a non-zero metric value.
  const visible = cities.filter((c) => c[metric] > 0);

  visible.forEach((city, idx) => {
    const r = bubbleRadius(city[metric], max);
    const html = `<div class="city-bubble" style="
      width:${r * 2}px;height:${r * 2}px;
      margin-left:${-r}px;margin-top:${-r}px;
      animation-delay:${Math.min(idx * 4, 800)}ms;
    "></div>`;

    const icon = L.divIcon({
      html,
      className: "city-bubble-wrapper",
      iconSize: [r * 2, r * 2],
      iconAnchor: [r, r],
    });

    const marker = L.marker([city.lat, city.lng], {
      icon,
      zIndexOffset: Math.round(max - city[metric]),
      keyboard: false,
      interactive: true,
      riseOnHover: true,
    });

    marker.on("mouseover", (e) => {
      const ev = (e as any).originalEvent as MouseEvent;
      onHover(city, ev);
    });
    marker.on("mouseout", () => onHover(null, null as any));
    marker.on("mousemove", (e) => {
      const ev = (e as any).originalEvent as MouseEvent;
      onHover(city, ev);
    });
    marker.on("click", () => onClick(city));

    marker.addTo(state.bubbles);
    state.markers.set(city.rank, marker);
  });
}

// Build the heatmap layer. leaflet.heat accepts [lat, lng, intensity].
export function renderHeat(
  map: L.Map,
  state: LayerState,
  cities: City[],
  metric: Metric
) {
  if (state.heat) {
    map.removeLayer(state.heat);
    state.heat = null;
  }
  const max = maxValue(cities, metric);
  const points: Array<[number, number, number]> = cities
    .filter((c) => c[metric] > 0)
    .map((c) => [c.lat, c.lng, 0.05 + 1.2 * Math.sqrt(c[metric] / max)]);

  // @ts-expect-error leaflet.heat augments L at runtime
  const heat = L.heatLayer(points, {
    radius: 22,
    blur: 18,
    maxZoom: 6,
    minOpacity: 0.12,
    gradient: {
      0.0: "#3a1a0a",
      0.2: "#8a3f12",
      0.4: "#c47a1c",
      0.6: "#f5b342",
      0.8: "#ffd97a",
      1.0: "#fff4cc",
    },
  });
  heat.addTo(map);
  state.heat = heat;
}

export function setView(
  map: L.Map,
  state: LayerState,
  view: ViewMode,
  metric: Metric,
  cities: City[],
  onHover: (city: City | null, evt: MouseEvent) => void,
  onClick: (city: City) => void
) {
  if (view === "bubbles") {
    if (state.heat) {
      map.removeLayer(state.heat);
      state.heat = null;
    }
    if (!map.hasLayer(state.bubbles)) state.bubbles.addTo(map);
    renderBubbles(map, state, cities, metric, onHover, onClick);
  } else {
    map.removeLayer(state.bubbles);
    renderHeat(map, state, cities, metric);
  }
}

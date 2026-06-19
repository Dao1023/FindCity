import type { City, Metric } from "./data.ts";

interface TooltipEls {
  root: HTMLDivElement;
  city: HTMLDivElement;
  country: HTMLDivElement;
  stats: HTMLDListElement;
  insts: HTMLDivElement;
}

export function createTooltip(): TooltipEls {
  const root = document.createElement("div");
  root.className = "tooltip";
  root.innerHTML = `
    <div class="t-city"></div>
    <div class="t-country"></div>
    <dl class="t-stats">
      <dt>Share</dt><dd class="gold t-share"></dd>
      <dt>Count</dt><dd class="t-count"></dd>
      <dt>Institutions</dt><dd class="t-inst-count"></dd>
      <dt>Rank</dt><dd class="t-rank"></dd>
    </dl>
    <div class="t-insts">
      <span class="t-insts-label">Top institutions</span>
      <span class="t-inst-list"></span>
    </div>
  `;
  document.body.appendChild(root);
  return {
    root,
    city: root.querySelector(".t-city")!,
    country: root.querySelector(".t-country")!,
    stats: root.querySelector(".t-stats")!,
    insts: root.querySelector(".t-insts")!,
  };
}

function formatNumber(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(1).replace(/\.0$/, "");
  return n.toFixed(2);
}

export function showTooltip(
  t: TooltipEls,
  city: City,
  evt: MouseEvent,
  metric: Metric
) {
  t.city.textContent = city.city;
  t.country.textContent = city.country;
  (t.stats.querySelector(".t-share") as HTMLElement).textContent =
    formatNumber(city.share);
  (t.stats.querySelector(".t-count") as HTMLElement).textContent =
    formatNumber(city.count);
  (t.stats.querySelector(".t-inst-count") as HTMLElement).textContent =
    String(city.institutions);
  (t.stats.querySelector(".t-rank") as HTMLElement).textContent = `#${city.rank}`;

  const insts = city.topInstitutions
    ? city.topInstitutions.split(" | ").slice(0, 3).join("\n")
    : "—";
  (t.insts.querySelector(".t-inst-list") as HTMLElement).textContent = insts;

  // Position near cursor, clamped to viewport.
  const pad = 16;
  const w = t.root.offsetWidth || 260;
  const h = t.root.offsetHeight || 200;
  let x = evt.clientX + pad;
  let y = evt.clientY + pad;
  if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
  t.root.style.left = `${Math.max(8, x)}px`;
  t.root.style.top = `${Math.max(8, y)}px`;
  t.root.classList.add("visible");

  // Highlight the active metric.
  t.stats.querySelectorAll("dd").forEach((dd) => dd.classList.remove("gold"));
  const sel = metric === "share" ? ".t-share" : ".t-count";
  t.stats.querySelector(sel)?.classList.add("gold");
}

export function hideTooltip(t: TooltipEls) {
  t.root.classList.remove("visible");
}

export interface RailElements {
  list: HTMLOListElement;
  metricLabel: HTMLSpanElement;
}

export function renderRail(
  rail: RailElements,
  cities: City[],
  metric: Metric,
  onSelect: (city: City) => void
) {
  rail.metricLabel.textContent = metric === "share" ? "Share" : "Count";
  rail.list.innerHTML = "";

  // Re-sort by metric so the rail reflects current ranking.
  const sorted = [...cities].sort((a, b) => b[metric] - a[metric]).slice(0, 25);
  sorted.forEach((city, idx) => {
    const li = document.createElement("li");
    li.className = "rail-item";
    li.dataset.rank = String(city.rank);
    li.innerHTML = `
      <span class="rail-rank">${String(idx + 1).padStart(2, "0")}</span>
      <span class="rail-name">${escapeHtml(city.city)}</span>
      <span class="rail-value">${formatNumber(city[metric])}</span>
    `;
    li.addEventListener("click", () => onSelect(city));
    li.addEventListener("mouseenter", () => li.classList.add("active"));
    li.addEventListener("mouseleave", () => li.classList.remove("active"));
    rail.list.appendChild(li);
  });
}

export function highlightRailItem(rail: RailElements, rank: number | null) {
  rail.list.querySelectorAll(".rail-item").forEach((el) => {
    el.classList.toggle("active", el instanceof HTMLElement && el.dataset.rank === String(rank));
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

export function wireToggle(
  id: string,
  initial: string,
  onChange: (value: string) => void
): void {
  const toggle = document.getElementById(id);
  if (!toggle) return;
  toggle.querySelectorAll("button").forEach((btn) => {
    if (btn.dataset[id.replace("-toggle", "")] === initial) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
    btn.addEventListener("click", () => {
      toggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const key = `data-${id.replace("-toggle", "")}`;
      onChange(btn.getAttribute(key) || "");
    });
  });
}

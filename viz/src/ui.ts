import {
  pointName,
  pointRank,
  pointSub,
  pointValue,
  type Granularity,
  type Metric,
  type Point,
} from "./data.ts";

interface TooltipEls {
  root: HTMLDivElement;
  name: HTMLDivElement;
  sub: HTMLDivElement;
  stats: HTMLDListElement;
  detailWrap: HTMLDivElement;
  detailLabel: HTMLSpanElement;
  detailList: HTMLSpanElement;
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
      <dt class="t-sub-label">Institutions</dt><dd class="t-sub-count"></dd>
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
    name: root.querySelector(".t-city")!,
    sub: root.querySelector(".t-country")!,
    stats: root.querySelector(".t-stats")!,
    detailWrap: root.querySelector(".t-insts")!,
    detailLabel: root.querySelector(".t-insts-label")!,
    detailList: root.querySelector(".t-inst-list")!,
  };
}

function formatNumber(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(1).replace(/\.0$/, "");
  return n.toFixed(2);
}

export function showTooltip(
  t: TooltipEls,
  p: Point,
  evt: MouseEvent,
  metric: Metric
) {
  t.name.textContent = pointName(p);
  t.sub.textContent = pointSub(p).toUpperCase();

  const subLabel = t.stats.querySelector(".t-sub-label") as HTMLElement;
  if (p.kind === "city") {
    subLabel.textContent = "Institutions";
    (t.stats.querySelector(".t-sub-count") as HTMLElement).textContent =
      String(p.institutions);
  } else {
    subLabel.textContent = "Cities";
    (t.stats.querySelector(".t-sub-count") as HTMLElement).textContent =
      String(p.cities);
  }

  (t.stats.querySelector(".t-share") as HTMLElement).textContent =
    formatNumber(p.share);
  (t.stats.querySelector(".t-count") as HTMLElement).textContent =
    formatNumber(p.count);
  (t.stats.querySelector(".t-rank") as HTMLElement).textContent =
    `#${pointRank(p, metric)}`;

  const list = p.kind === "city" ? p.topInstitutions : p.topCities;
  const detail = list ? list.split(" | ").slice(0, 3).join("\n") : "—";
  t.detailLabel.textContent = p.kind === "city" ? "Top institutions" : "Top cities";
  t.detailList.textContent = detail;

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
  headLabel: HTMLSpanElement;
}

export function renderRail(
  rail: RailElements,
  points: Point[],
  metric: Metric,
  granularity: Granularity,
  onSelect: (p: Point) => void
) {
  rail.metricLabel.textContent = metric === "share" ? "Share" : "Count";
  rail.headLabel.textContent =
    granularity === "city" ? "Top Cities" : "Top Countries";
  rail.list.innerHTML = "";

  const sorted = [...points]
    .sort((a, b) => pointValue(b, metric) - pointValue(a, metric))
    .slice(0, 25);
  sorted.forEach((p, idx) => {
    const li = document.createElement("li");
    li.className = "rail-item";
    li.dataset.rank = String(pointRank(p, metric));
    li.innerHTML = `
      <span class="rail-rank">${String(idx + 1).padStart(2, "0")}</span>
      <span class="rail-name">${escapeHtml(pointName(p))}</span>
      <span class="rail-value">${formatNumber(pointValue(p, metric))}</span>
    `;
    li.addEventListener("click", () => onSelect(p));
    li.addEventListener("mouseenter", () => li.classList.add("active"));
    li.addEventListener("mouseleave", () => li.classList.remove("active"));
    rail.list.appendChild(li);
  });
}

export function highlightRailItem(rail: RailElements, rank: number | null) {
  rail.list.querySelectorAll(".rail-item").forEach((el) => {
    el.classList.toggle(
      "active",
      el instanceof HTMLElement && el.dataset.rank === String(rank)
    );
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
  const key = id.replace("-toggle", "");
  toggle.querySelectorAll("button").forEach((btn) => {
    if (btn.dataset[key] === initial) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
    btn.addEventListener("click", () => {
      toggle
        .querySelectorAll("button")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      onChange(btn.dataset[key] || "");
    });
  });
}

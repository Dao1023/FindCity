/**
 * analyze-curve.ts
 *
 * Match-rate curve over row position. Important context: the input data has
 * Share values only for the top ~4338 rows (Nature Index ranks institutions
 * by Share, then everything beyond ties at Share=0 with Count often = 1).
 *
 * So the meaningful curve is over the Share-bearing slice. Beyond that,
 * Share-based coverage is undefined; only Count can be aggregated.
 */
import { readFileSync } from "node:fs";
import Papa from "papaparse";

interface Row {
  Position: number;
  Share: number;
  Count: number;
  matched: string | boolean;
}

const rows = Papa.parse<Row>(readFileSync("out/institutions.csv", "utf8"), {
  header: true,
  skipEmptyLines: true,
  dynamicTyping: { Position: "number", Share: "number", Count: "number" },
}).data;

const n = rows.length;
const matched = rows.map((r) => r.matched === true || r.matched === "true");
const share = rows.map((r) => Number(r.Share) || 0);
const count = rows.map((r) => Number(r.Count) || 0);

// Find the last row that has a non-zero Share.
let lastShareRow = 0;
let totalShare = 0;
for (let i = 0; i < n; i++) {
  if (share[i] > 0) {
    lastShareRow = i + 1;
    totalShare += share[i];
  }
}

console.log(`Total rows:           ${n}`);
console.log(`Rows with Share > 0:  ${lastShareRow}`);
console.log(`Rows with Share = 0:  ${n - lastShareRow} (tied tail)`);
console.log(`Total Share (top):    ${totalShare.toLocaleString()}`);

// === Curve A: cumulative row match rate over Share-bearing slice ===
const step = 100;
function chartRow(title: string, endRow: number) {
  console.log(`\n${title}  (rows 1..${endRow})`);
  console.log("─".repeat(82));
  let m = 0;
  let sm = 0;
  let st = 0;
  for (let i = 0; i < endRow; i++) {
    if (matched[i]) m++;
    sm += matched[i] ? share[i] : 0;
    st += share[i];
    if ((i + 1) % step === 0 || i === endRow - 1) {
      const rate = m / (i + 1);
      const srate = st > 0 ? sm / st : 0;
      const bar = "█".repeat(Math.round(rate * 70)).padEnd(70);
      console.log(
        `${String(i + 1).padStart(5)}  ${bar} ${(rate * 100).toFixed(1)}%  ` +
          `share ${(srate * 100).toFixed(1)}%`
      );
    }
  }
}

chartRow("Cumulative row match rate", lastShareRow);

// === Curve B: rolling window match rate, shows where it collapses ===
const win = 200;
console.log(`\nRolling window match rate (window=${win}, rows 1..${lastShareRow})`);
console.log("─".repeat(82));
for (let i = win - 1; i < lastShareRow; i += step) {
  let mw = 0;
  for (let j = i - win + 1; j <= i; j++) if (matched[j]) mw++;
  const rate = mw / win;
  const bar = "█".repeat(Math.round(rate * 70)).padEnd(70);
  console.log(`${String(i + 1).padStart(5)}  ${bar} ${(rate * 100).toFixed(1)}%`);
}

// === Inflection: largest single drop in rolling rate ===
// Compute rolling rate at every `step` rows, then find biggest drop.
const rollingSeries: Array<{ row: number; rate: number }> = [];
for (let i = win - 1; i < lastShareRow; i += step) {
  let mw = 0;
  for (let j = i - win + 1; j <= i; j++) if (matched[j]) mw++;
  rollingSeries.push({ row: i + 1, rate: mw / win });
}
let maxDrop = 0;
let inflection = -1;
for (let k = 1; k < rollingSeries.length; k++) {
  const drop = rollingSeries[k - 1].rate - rollingSeries[k].rate;
  if (drop > maxDrop) {
    maxDrop = drop;
    inflection = rollingSeries[k].row;
  }
}
console.log(
  `\nLargest rolling-rate drop: ${(maxDrop * 100).toFixed(1)} pp around row ${inflection}`
);

// === Where does cumulative Share coverage hit thresholds? ===
// Share coverage = (sum of matched Share for rows 1..N) / (total Share in dataset)
console.log(
  "\nShare-coverage milestones (matched Share / total Share, accumulated):"
);
let sm = 0;
const milestones: Record<number, number | null> = {
  50: null,
  75: null,
  90: null,
  95: null,
  99: null,
};
for (let i = 0; i < lastShareRow; i++) {
  if (matched[i]) sm += share[i];
  const srate = sm / totalShare;
  for (const pctStr of Object.keys(milestones)) {
    const pct = Number(pctStr);
    if (milestones[pct] === null && srate * 100 >= pct) {
      milestones[pct] = i + 1;
    }
  }
}
for (const [pct, row] of Object.entries(milestones)) {
  console.log(`  ${pct}% Share coverage reached at row ${row}`);
}

// === Band summary ===
console.log("\nMatch rate & Share coverage by band (over Share-bearing rows):");
console.log("─".repeat(75));
const bands = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, lastShareRow];
let prev = 0;
for (const end of bands) {
  const start = prev;
  prev = end;
  let m = 0, cnt = 0, sw = 0, st = 0;
  for (let i = start; i < end; i++) {
    cnt++;
    if (matched[i]) m++;
    sw += matched[i] ? share[i] : 0;
    st += share[i];
  }
  const rate = (m / cnt) * 100;
  const srate = st > 0 ? (sw / st) * 100 : 0;
  console.log(
    `rows ${String(start + 1).padStart(5)}-${String(end).padEnd(5)}  ` +
      `match ${rate.toFixed(1).padStart(5)}%  shareCov ${srate.toFixed(1).padStart(5)}%  ` +
      `(${m}/${cnt})`
  );
}

// === Tail (Share=0): only Count applies ===
console.log(`\nTail analysis (rows ${lastShareRow + 1}..${n}, all Share=0):`);
let tm = 0;
let tc = 0;
for (let i = lastShareRow; i < n; i++) {
  tc++;
  if (matched[i]) tm++;
}
console.log(
  `  match rate: ${(tm / tc * 100).toFixed(1)}% (${tm}/${tc})  -- these rows are all tied, Count mostly 1`
);

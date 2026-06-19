/**
 * aggregate.ts
 *
 * Reads out/institutions.csv (from match.ts) and aggregates to:
 *   - out/city_ranking.csv: per (city, country, lat, lng), summed Count and
 *     Share, plus the number of contributing institutions.
 *
 * Outputs two ranking columns: Count_sum and Share_sum, so the user can compare
 * which metric tells a more honest story.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import Papa from "papaparse";
import type { MatchResult } from "./types.ts";

const INPUT_CSV = "out/institutions.csv";
const OUTPUT_CSV = "out/city_ranking.csv";

interface CityAgg {
  city: string;
  country: string;
  lat: number | null;
  lng: number | null;
  count_sum: number;
  share_sum: number;
  institution_count: number;
  // Top 3 institutions by Share for sanity-checking the city.
  top_institutions: string;
}

function main() {
  mkdirSync("out", { recursive: true });
  console.error(`Reading ${INPUT_CSV} ...`);
  const rows = Papa.parse<MatchResult>(readFileSync(INPUT_CSV, "utf8"), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: {
      Position: "number",
      Count: "number",
      Share: "number",
      lat: "number",
      lng: "number",
      match_score: "number",
    },
  }).data.filter(
    (r) => r.matched === true || r.matched === "true"
  );

  console.error(`Matched rows: ${rows.length}`);

  // Key: `${country}::${city}` (case-insensitive) to merge spellings like
  // "Cambridge" appearing twice in different countries.
  const cities = new Map<string, CityAgg>();
  const tops = new Map<string, Array<{ name: string; share: number }>>();

  // Recompute totals over the full input (matched + unmatched) so coverage
  // reflects the share we lost to unmatched institutions.
  const allRows = Papa.parse<MatchResult>(readFileSync(INPUT_CSV, "utf8"), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: {
      Position: "number",
      Count: "number",
      Share: "number",
      lat: "number",
      lng: "number",
      match_score: "number",
    },
  }).data;
  let totalShare = 0;
  let totalShareMatched = 0;
  for (const r of allRows) {
    const share = Number(r.Share) || 0;
    totalShare += share;
  }

  for (const r of rows) {
    const city = (r.city ?? "").trim();
    const country = (r["Country/territory"] ?? "").trim();
    if (!city) continue; // skip rows where ROR had no city
    const share = Number(r.Share) || 0;
    const count = Number(r.Count) || 0;

    const key = `${country.toLowerCase()}::${city.toLowerCase()}`;
    let agg = cities.get(key);
    if (!agg) {
      agg = {
        city,
        country,
        lat: r.lat,
        lng: r.lng,
        count_sum: 0,
        share_sum: 0,
        institution_count: 0,
        top_institutions: "",
      };
      cities.set(key, agg);
      tops.set(key, []);
    }
    agg.count_sum += count;
    agg.share_sum += share;
    agg.institution_count += 1;
    totalShareMatched += share;

    const t = tops.get(key)!;
    t.push({ name: r.Institution, share });
    if (t.length > 3) {
      t.sort((a, b) => b.share - a.share);
      t.length = 3;
    }
  }

  // Build output rows: sort by share_sum desc.
  const out: Array<CityAgg & { rank_by_share: number; rank_by_count: number }> =
    [];
  const byShare = [...cities.values()].sort((a, b) => b.share_sum - a.share_sum);
  const byCount = [...cities.values()].sort((a, b) => b.count_sum - a.count_sum);

  // Compose top_institutions strings.
  for (const c of byShare) {
    const t = (tops.get(`${c.country.toLowerCase()}::${c.city.toLowerCase()}`) ?? [])
      .slice()
      .sort((a, b) => b.share - a.share)
      .slice(0, 3)
      .map((x) => `${x.name} (${x.share})`)
      .join(" | ");
    c.top_institutions = t;
  }

  const rankByShare = new Map<string, number>();
  byShare.forEach((c, i) => rankByShare.set(c.city + c.country, i + 1));
  const rankByCount = new Map<string, number>();
  byCount.forEach((c, i) => rankByCount.set(c.city + c.country, i + 1));

  for (const c of byShare) {
    out.push({
      ...c,
      rank_by_share: rankByShare.get(c.city + c.country)!,
      rank_by_count: rankByCount.get(c.city + c.country)!,
    });
  }

  const csv = Papa.unparse({
    fields: [
      "rank_by_share",
      "rank_by_count",
      "city",
      "country",
      "lat",
      "lng",
      "count_sum",
      "share_sum",
      "institution_count",
      "top_institutions",
    ],
    data: out,
  });
  writeFileSync(OUTPUT_CSV, csv);
  console.error(`Wrote ${OUTPUT_CSV} (${out.length} cities)`);

  // Print top 20 to stderr for a quick eyeball check.
  console.log("\n=== Top 20 cities by Share ===");
  console.log(
    "rank  city                          country         share    count   #inst"
  );
  byShare.slice(0, 20).forEach((c, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ` +
        `${c.city.padEnd(30)} ${c.country.padEnd(16)} ` +
        `${String(c.share_sum).padStart(7)}  ${String(c.count_sum).padStart(7)}  ` +
        `${c.institution_count}`
    );
  });

  console.log(
    `\nCoverage: matched rows hold ${totalShareMatched.toLocaleString()} / ${totalShare.toLocaleString()} total Share ` +
      `(${((totalShareMatched / totalShare) * 100).toFixed(1)}%)`
  );
}

main();

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
const OUTPUT_COUNTRY_CSV = "out/country_ranking.csv";

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

  // ── Country aggregation ─────────────────────────────────────────
  // Key: lowercased country label. Centroid = Share-weighted mean of
  // matched institutions' lat/lng, so the marker sits over the actual
  // research cluster rather than the geometric middle of a continent.
  interface CountryAgg {
    country: string;
    count_sum: number;
    share_sum: number;
    city_count: number;
    institution_count: number;
    lat: number;
    lng: number;
    top_cities: string;
  }

  // First pass: per-country accumulators.
  const cAcc = new Map<
    string,
    {
      country: string;
      count_sum: number;
      share_sum: number;
      latW: number; // share-weighted lat
      lngW: number;
      wSum: number;
      institutions: Set<string>; // unique (country::city) keys → city count proxy
      instCount: number;
      cities: Map<string, number>; // city label → share_sum
    }
  >();

  for (const r of rows) {
    const country = (r["Country/territory"] ?? "").trim();
    if (!country) continue;
    const city = (r.city ?? "").trim();
    const share = Number(r.Share) || 0;
    const count = Number(r.Count) || 0;
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const key = country.toLowerCase();
    let a = cAcc.get(key);
    if (!a) {
      a = {
        country,
        count_sum: 0,
        share_sum: 0,
        latW: 0,
        lngW: 0,
        wSum: 0,
        institutions: new Set(),
        instCount: 0,
        cities: new Map(),
      };
      cAcc.set(key, a);
    }
    a.count_sum += count;
    a.share_sum += share;
    if (Number.isFinite(lat) && Number.isFinite(lng) && share > 0) {
      a.latW += lat * share;
      a.lngW += lng * share;
      a.wSum += share;
    }
    if (city) {
      a.institutions.add(`${city.toLowerCase()}`);
      a.cities.set(city, (a.cities.get(city) ?? 0) + share);
    }
    a.instCount += 1;
  }

  const byShareC = [...cAcc.values()].sort(
    (a, b) => b.share_sum - a.share_sum
  );
  const byCountC = [...cAcc.values()].sort(
    (a, b) => b.count_sum - a.count_sum
  );

  const rankByShareC = new Map<string, number>();
  byShareC.forEach((c, i) => rankByShareC.set(c.country, i + 1));
  const rankByCountC = new Map<string, number>();
  byCountC.forEach((c, i) => rankByCountC.set(c.country, i + 1));

  const outC: Array<CountryAgg & { rank_by_share: number; rank_by_count: number }> =
    [];
  for (const a of byShareC) {
    const topCities = [...a.cities.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([name, s]) => `${name} (${Math.round(s)})`)
      .join(" | ");
    outC.push({
      country: a.country,
      count_sum: a.count_sum,
      share_sum: a.share_sum,
      city_count: a.institutions.size,
      institution_count: a.instCount,
      lat: a.wSum > 0 ? a.latW / a.wSum : 0,
      lng: a.wSum > 0 ? a.lngW / a.wSum : 0,
      top_cities: topCities,
      rank_by_share: rankByShareC.get(a.country)!,
      rank_by_count: rankByCountC.get(a.country)!,
    });
  }

  const csvC = Papa.unparse({
    fields: [
      "rank_by_share",
      "rank_by_count",
      "country",
      "lat",
      "lng",
      "count_sum",
      "share_sum",
      "city_count",
      "institution_count",
      "top_cities",
    ],
    data: outC,
  });
  writeFileSync(OUTPUT_COUNTRY_CSV, csvC);
  console.error(`Wrote ${OUTPUT_COUNTRY_CSV} (${outC.length} countries)`);

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

  console.log("\n=== Top 20 countries by Share ===");
  console.log(
    "rank  country                        share    count   #city  #inst"
  );
  outC.slice(0, 20).forEach((c, i) => {
    console.log(
      `${String(i + 1).padStart(4)}  ` +
        `${c.country.padEnd(30)} ` +
        `${String(Math.round(c.share_sum)).padStart(7)}  ${String(c.count_sum).padStart(7)}  ` +
        `${String(c.city_count).padStart(5)}  ${c.institution_count}`
    );
  });

  console.log(
    `\nCoverage: matched rows hold ${totalShareMatched.toLocaleString()} / ${totalShare.toLocaleString()} total Share ` +
      `(${((totalShareMatched / totalShare) * 100).toFixed(1)}%)`
  );
}

main();

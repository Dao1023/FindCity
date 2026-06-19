/**
 * match.ts
 *
 * Reads data.csv, matches each institution to a ROR record via cascade:
 *   1. exact normalized name (incl. aliases & acronyms)
 *   2. acronym-only exact lookup
 *   3. country-filtered FTS5 trigram candidates, re-ranked by Sorensen-Dice
 * Writes out/institutions.csv with city, lat, lng, ror_id, strategy, score.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import Papa from "papaparse";
import { normalize, countryToCode } from "./normalize.ts";
import type { RorSlim, InstitutionRow, MatchResult } from "./types.ts";

const SLIM_PATH = ".ror-cache/ror-slim.json";
const NAMES_PATH = ".ror-cache/ror-names.json";
const SQLITE_PATH = ".ror-cache/ror.sqlite";
const INPUT_CSV = "data.csv";
const OUTPUT_CSV = "out/institutions.csv";

// Below this Dice similarity we refuse to call it a match.
const FUZZY_MIN_DICE = 0.45;
// A name match this close to the query is treated as a strong (alias-level) hit.
const FUZZY_STRONG_DICE = 0.85;

interface LoadedIndex {
  byCountry: Record<string, RorSlim[]>;
  byName: Record<string, string[]>;
  byId: Map<string, RorSlim>;
  db: Database;
  ftsQuery: ReturnType<Database["prepare"]>;
}

function loadIndex(): LoadedIndex {
  const byCountry = JSON.parse(readFileSync(SLIM_PATH, "utf8")) as Record<
    string,
    RorSlim[]
  >;
  const byName = JSON.parse(readFileSync(NAMES_PATH, "utf8")) as Record<
    string,
    string[]
  >;
  const byId = new Map<string, RorSlim>();
  for (const list of Object.values(byCountry)) {
    for (const s of list) byId.set(s.id, s);
  }
  const db = new Database(SQLITE_PATH, { readonly: true });
  const ftsQuery = db.prepare(
    `SELECT id FROM org_fts WHERE org_fts MATCH ? AND country_code = ?
     ORDER BY rank LIMIT 8`
  );
  return { byCountry, byName, byId, db, ftsQuery };
}

// Look up an exact name; if multiple ids share the spelling, prefer one in the
// expected country (otherwise return the first).
function exactLookup(
  norm: string,
  expectedCc: string | null,
  idx: LoadedIndex
): RorSlim | null {
  const ids = idx.byName[norm];
  if (!ids || ids.length === 0) return null;
  if (expectedCc) {
    for (const id of ids) {
      const s = idx.byId.get(id);
      if (s && s.country_code === expectedCc) return s;
    }
  }
  return idx.byId.get(ids[0]) ?? null;
}

// Strip cosmetic prefix/suffix that often differ between source and ROR:
//   "The Pennsylvania State University" -> "Pennsylvania State University"
//   "Pfizer Inc."                       -> "Pfizer"
//   "AstraZeneca plc"                   -> "AstraZeneca"
const LEADING_ARTICLES = /^(the|le|la|les|el|los|las|der|die|das)\s+/i;
const TRAILING_SUFFIX =
  /\s+(incorporated|inc|llc|ltd|limited|plc|corp|corporation|co|gmbh|bv|sa|ag|kg|oy|ab|srl|spa|pty|pvt)\.?\s*$/i;

function cosmeticClean(s: string): string {
  let out = s.replace(LEADING_ARTICLES, "").trim();
  let prev = "";
  while (prev !== out) {
    prev = out;
    out = out.replace(TRAILING_SUFFIX, "").trim();
  }
  return out;
}

/**
 * Extract a trailing parenthetical acronym from an institution string.
 * "Peking University (PKU)"  -> { name: "Peking University", acronym: "PKU" }
 * Also strips a comma-led form like "MIT, Massachusetts...".
 */
function splitAcronym(raw: string): { name: string; acronym: string | null } {
  const m = raw.match(/^(.*?)\s*\(([^()]{1,12})\)\s*$/);
  if (m) {
    const inner = m[2].trim();
    // Treat as acronym only if short and alnum (avoid matching "(USA)" country bits).
    if (/^[A-Za-z0-9&\-]{1,12}$/.test(inner)) {
      return { name: m[1].trim(), acronym: inner };
    }
  }
  return { name: raw.trim(), acronym: null };
}

// Build the set of character bigrams in a normalized string.
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

// Sorensen-Dice coefficient over bigram sets; 0..1.
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

function buildResult(
  base: MatchResult,
  slim: RorSlim,
  strategy: "exact" | "alias" | "acronym" | "fuzzy",
  score: number
): MatchResult {
  return {
    ...base,
    matched: true,
    ror_id: slim.id,
    ror_name: slim.name,
    city: slim.city || null,
    lat: slim.lat,
    lng: slim.lng,
    match_strategy: strategy,
    match_score: score,
  };
}

export function matchRow(row: InstitutionRow, idx: LoadedIndex): MatchResult {
  const base: MatchResult = {
    ...row,
    matched: false,
    ror_id: null,
    ror_name: null,
    city: null,
    lat: null,
    lng: null,
    match_strategy: "none",
    match_score: 0,
  };

  const rawInst = (row.Institution ?? "").trim();
  if (!rawInst) return base;
  const { name: cleanName, acronym } = splitAcronym(rawInst);

  const expectedCc = countryToCode(row["Country/territory"]);

  // Build a small set of candidate names to try verbatim: the original, and a
  // cosmetically-cleaned version that drops articles and legal suffixes.
  const nameVariants = new Set<string>();
  nameVariants.add(cleanName);
  const cleaned = cosmeticClean(cleanName);
  if (cleaned && cleaned !== cleanName) nameVariants.add(cleaned);

  const normAcronym = acronym ? normalize(acronym) : null;

  // Strategy 1: exact lookup on any name variant.
  for (const v of nameVariants) {
    const norm = normalize(v);
    if (!norm) continue;
    const slim = exactLookup(norm, expectedCc, idx);
    if (slim) return buildResult(base, slim, "exact", 1);
  }

  // Strategy 2: acronym-only exact lookup (handles "MIT" -> "Mass. Institute...").
  if (normAcronym) {
    const slim = exactLookup(normAcronym, expectedCc, idx);
    if (slim) return buildResult(base, slim, "acronym", 0.95);
  }

  // Strategy 3: country-filtered FTS5 trigram candidates, re-ranked by Dice.
  if (expectedCc) {
    // Try each name variant as a phrase query first (high precision), then
    // fall back to a token-OR query (higher recall).
    const variants = [...nameVariants].filter(Boolean);
    let ftsRows: Array<{ id: string }> = [];
    for (const v of variants) {
      try {
        const phrase = `"${v}"`;
        const r = idx.ftsQuery.all(phrase, expectedCc) as Array<{ id: string }>;
        if (r.length) { ftsRows = r; break; }
      } catch {
        /* ignore */
      }
    }
    if (ftsRows.length === 0) {
      for (const v of variants) {
        const norm = normalize(v);
        const tokens = norm.split(" ").filter((t) => t.length > 2);
        if (tokens.length === 0) continue;
        try {
          const r = idx.ftsQuery.all(tokens.join(" "), expectedCc) as Array<{ id: string }>;
          if (r.length) { ftsRows = r; break; }
        } catch {
          /* ignore */
        }
      }
    }

    let best: { slim: RorSlim; score: number } | null = null;
    for (const r of ftsRows) {
      const slim = idx.byId.get(r.id);
      if (!slim) continue;
      // Score against every variant vs every alias; keep the best.
      let score = 0;
      for (const v of variants) {
        const nv = normalize(v);
        let s = dice(nv, normalize(slim.name));
        for (const alias of slim.aliases) {
          const d = dice(nv, normalize(alias));
          if (d > s) s = d;
        }
        if (s > score) score = s;
      }
      if (normAcronym) {
        for (const acr of slim.acronyms) {
          if (normalize(acr) === normAcronym) {
            score = Math.max(score, 0.95);
            break;
          }
        }
      }
      if (!best || score > best.score) best = { slim, score };
    }

    if (best && best.score >= FUZZY_MIN_DICE) {
      const strategy: "alias" | "fuzzy" =
        best.score >= FUZZY_STRONG_DICE ? "alias" : "fuzzy";
      return buildResult(base, best.slim, strategy, best.score);
    }
  }

  return base;
}

function main() {
  mkdirSync("out", { recursive: true });
  console.error("Loading ROR index ...");
  const idx = loadIndex();
  console.error(
    `Loaded ${idx.byId.size} orgs, ${Object.keys(idx.byName).length} names`
  );

  console.error(`Parsing ${INPUT_CSV} ...`);
  const csvText = readFileSync(INPUT_CSV, "utf8");
  // Parse raw (no header) so we can repair rows where the institution name
  // contains an unquoted comma (e.g. "University of California, Berkeley").
  // Schema: Position, Institution..., Country, Count, Share, City?
  const parsed = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  });
  const rows: InstitutionRow[] = [];
  let repaired = 0;
  for (const raw of parsed.data) {
    if (!raw || raw.length < 5) continue;
    // Drop a trailing empty City column if present.
    let fields = raw;
    if (fields[fields.length - 1] === "") fields = fields.slice(0, -1);
    if (fields.length < 5) continue;
    // Right-to-left: Share, Count, Country. Left: Position, then Institution.
    const share = Number(fields[fields.length - 1]);
    const count = Number(fields[fields.length - 2]);
    const country = fields[fields.length - 3];
    const position = Number(fields[0]);
    if (Number.isNaN(count) || Number.isNaN(share)) continue;
    const institution = fields.slice(1, fields.length - 3).join(", ").trim();
    if (!institution || !country) continue;
    if (fields.length > 6) repaired++;
    rows.push({
      Position: position,
      Institution: institution,
      "Country/territory": country.trim(),
      Count: count,
      Share: share,
    });
  }
  console.error(`Rows to match: ${rows.length} (${repaired} comma-repaired)`);

  const results: MatchResult[] = [];
  const stratCounts: Record<string, number> = {};
  let matched = 0;
  const t0 = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const r = matchRow(rows[i], idx);
    results.push(r);
    stratCounts[r.match_strategy] = (stratCounts[r.match_strategy] ?? 0) + 1;
    if (r.matched) matched++;
    if ((i + 1) % 2000 === 0) {
      console.error(
        `  ${i + 1}/${rows.length}  matched=${matched} (${(
          (matched / (i + 1)) *
          100
        ).toFixed(1)}%)  elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
    }
  }

  const fields = [
    "Position",
    "Institution",
    "Country/territory",
    "Count",
    "Share",
    "matched",
    "ror_id",
    "ror_name",
    "city",
    "lat",
    "lng",
    "match_strategy",
    "match_score",
  ];
  const outCsv = Papa.unparse({ fields, data: results });
  writeFileSync(OUTPUT_CSV, outCsv);
  console.error(`\nWrote ${OUTPUT_CSV}`);

  console.log("\n=== Match stats ===");
  console.log(`Total:       ${results.length}`);
  console.log(
    `Matched:     ${matched} (${((matched / results.length) * 100).toFixed(1)}%)`
  );
  console.log(`Unmatched:   ${results.length - matched}`);
  console.log("By strategy:");
  for (const [k, v] of Object.entries(stratCounts)) {
    console.log(`  ${k.padEnd(10)} ${v}`);
  }
}

if (import.meta.main) main();

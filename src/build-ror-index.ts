/**
 * build-ror-index.ts
 *
 * Downloads the ROR data dump (if missing), parses v1.json, and writes:
 *   - ror-slim.json  : country_code -> RorSlim[]
 *   - ror-names.json : normalized-name -> ror_id (exact/alias/acronym lookup)
 *   - ror.sqlite     : FTS5 trigram index for fast fuzzy matching
 */
import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { Database } from "bun:sqlite";
import { normalize } from "./normalize.ts";
import type { RorSlim } from "./types.ts";

const CACHE_DIR = ".ror-cache";
const V1_PATH = join(CACHE_DIR, "v1.json");
const SLIM_PATH = join(CACHE_DIR, "ror-slim.json");
const NAMES_PATH = join(CACHE_DIR, "ror-names.json");
const SQLITE_PATH = join(CACHE_DIR, "ror.sqlite");
const ROR_ZIP_URL =
  "https://zenodo.org/records/17953395/files/v2.0-2025-12-16-ror-data.zip";

interface RorRawRecord {
  id: string;
  names?: Array<{ value: string; lang: string | null; types: string[] }>;
  locations?: Array<{
    geonames_id?: number;
    geonames_details?: {
      country_code?: string;
      country_name?: string;
      lat?: number;
      lng?: number;
      name?: string; // city
      country_subdivision_name?: string;
    };
  }>;
  types?: string[];
}

async function downloadRor() {
  console.log(`Downloading ROR data from ${ROR_ZIP_URL} ...`);
  const res = await fetch(ROR_ZIP_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const zipBytes = new Uint8Array(await res.arrayBuffer());
  console.log(`Downloaded ${(zipBytes.length / 1024 / 1024).toFixed(1)} MB, unzipping...`);

  const files = unzipSync(zipBytes, {
    filter: (f) => f.name.endsWith(".json"),
  });
  const jsonName = Object.keys(files).find((n) => n.endsWith(".json"));
  if (!jsonName) throw new Error("ror-data JSON not found in zip");

  const v1Bytes = files[jsonName];
  writeFileSync(V1_PATH, v1Bytes);
  console.log(`Extracted ${jsonName} -> ${V1_PATH} (${(v1Bytes.length / 1024 / 1024).toFixed(1)} MB)`);
}

function buildSlim(v1: RorRawRecord[]): {
  byCountry: Record<string, RorSlim[]>;
  byName: Record<string, string[]>;
} {
  const byCountry: Record<string, RorSlim[]> = {};
  const byName: Record<string, string[]> = {};

  for (const rec of v1) {
    const loc = rec.locations?.[0]?.geonames_details;
    if (!loc?.country_code) continue;
    const cc = loc.country_code;

    // In v2 schema, names[] carries typed entries. ror_display is canonical,
    // alias/label are alternates, acronym is short form.
    const typed = rec.names ?? [];
    const displayName = typed.find((n) => n.types?.includes("ror_display"))?.value ?? "";
    const aliases = typed
      .filter((n) => n.types?.some((t) => t === "alias" || t === "label"))
      .map((n) => n.value)
      .filter(Boolean);
    const acronyms = typed.filter((n) => n.types?.includes("acronym")).map((n) => n.value);

    const name = displayName || aliases[0] || "";
    if (!name) continue;

    const slim: RorSlim = {
      id: rec.id,
      name,
      aliases,
      acronyms,
      country_code: cc,
      country_name: loc.country_name ?? "",
      city: loc.name ?? "",
      lat: typeof loc.lat === "number" ? loc.lat : null,
      lng: typeof loc.lng === "number" ? loc.lng : null,
      types: rec.types ?? [],
    };

    (byCountry[cc] ??= []).push(slim);

    // Name index: register every known spelling. Store all ids so ambiguous
    // short forms (e.g. "UCL") can be disambiguated by country at match time.
    const allNames = [name, ...aliases, ...acronyms];
    for (const n of allNames) {
      const norm = normalize(n);
      if (!norm) continue;
      (byName[norm] ??= []).push(rec.id);
    }
  }

  return { byCountry, byName };
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });

  if (!existsSync(V1_PATH) || statSync(V1_PATH).size < 1_000_000) {
    await downloadRor();
  } else {
    console.log(`v1.json already cached (${(statSync(V1_PATH).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  console.log("Parsing v1.json ...");
  const v1: RorRawRecord[] = JSON.parse(readFileSync(V1_PATH, "utf8"));
  console.log(`Parsed ${v1.length} records`);

  const { byCountry, byName } = buildSlim(v1);
  const countries = Object.keys(byCountry).length;
  const totalSlim = Object.values(byCountry).reduce((s, a) => s + a.length, 0);

  console.log(`Slim records: ${totalSlim} across ${countries} countries`);
  console.log(`Name index entries: ${Object.keys(byName).length}`);

  writeFileSync(SLIM_PATH, JSON.stringify(byCountry));
  writeFileSync(NAMES_PATH, JSON.stringify(byName));
  console.log(`Wrote ${SLIM_PATH} and ${NAMES_PATH}`);

  // Build FTS5 trigram index for fast fuzzy matching.
  console.log("Building SQLite FTS5 trigram index ...");
  if (existsSync(SQLITE_PATH)) writeFileSync(SQLITE_PATH, "");
  const db = new Database(SQLITE_PATH);
  db.exec("PRAGMA journal_mode = OFF;");
  db.exec(`
    CREATE VIRTUAL TABLE org_fts USING fts5(
      search_text,
      country_code UNINDEXED,
      id UNINDEXED,
      tokenize = 'trigram case_sensitive 0'
    );
  `);
  const insert = db.prepare(
    "INSERT INTO org_fts (search_text, country_code, id) VALUES (?, ?, ?)"
  );
  const insertMany = db.transaction((rows: Array<[string, string, string]>) => {
    for (const [t, cc, id] of rows) insert.run(t, cc, id);
  });
  const batch: Array<[string, string, string]> = [];
  for (const list of Object.values(byCountry)) {
    for (const s of list) {
      const searchText = [s.name, ...s.aliases, ...s.acronyms].join(" | ");
      batch.push([searchText, s.country_code, s.id]);
    }
  }
  insertMany(batch);
  db.close();
  console.log(`Wrote ${SQLITE_PATH} (${batch.length} rows indexed)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

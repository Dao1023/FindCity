import Papa from "papaparse";

export type Metric = "share" | "count";
export type Granularity = "city" | "country";

export interface City {
  kind: "city";
  city: string;
  country: string;
  lat: number;
  lng: number;
  count: number;
  share: number;
  institutions: number;
  rankShare: number;
  rankCount: number;
  topInstitutions: string;
}

export interface Country {
  kind: "country";
  country: string;
  lat: number;
  lng: number;
  count: number;
  share: number;
  cities: number;
  institutions: number;
  rankShare: number;
  rankCount: number;
  topCities: string;
}

export type Point = City | Country;

// Accessors that work on either granularity, so layers/ui can stay generic.
export function pointValue(p: Point, m: Metric): number {
  return m === "share" ? p.share : p.count;
}

export function pointRank(p: Point, m: Metric): number {
  return m === "share" ? p.rankShare : p.rankCount;
}

export function pointName(p: Point): string {
  return p.kind === "city" ? p.city : p.country;
}

// Secondary label under the name: country for a city, empty for a country.
export function pointSub(p: Point): string {
  return p.kind === "city" ? p.country : "";
}

export async function loadCities(): Promise<City[]> {
  const res = await fetch("/city_ranking.csv");
  if (!res.ok) throw new Error(`Failed to fetch city_ranking.csv: ${res.status}`);
  const text = await res.text();

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const cities: City[] = [];
  for (const row of parsed.data) {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    cities.push({
      kind: "city",
      city: row.city?.trim() ?? "",
      country: row.country?.trim() ?? "",
      lat,
      lng,
      count: Number(row.count_sum) || 0,
      share: Number(row.share_sum) || 0,
      institutions: Number(row.institution_count) || 0,
      rankShare: Number(row.rank_by_share) || 0,
      rankCount: Number(row.rank_by_count) || 0,
      topInstitutions: row.top_institutions ?? "",
    });
  }

  cities.sort((a, b) => b.share - a.share);
  return cities;
}

export async function loadCountries(): Promise<Country[]> {
  const res = await fetch("/country_ranking.csv");
  if (!res.ok)
    throw new Error(`Failed to fetch country_ranking.csv: ${res.status}`);
  const text = await res.text();

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const countries: Country[] = [];
  for (const row of parsed.data) {
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    countries.push({
      kind: "country",
      country: row.country?.trim() ?? "",
      lat,
      lng,
      count: Number(row.count_sum) || 0,
      share: Number(row.share_sum) || 0,
      cities: Number(row.city_count) || 0,
      institutions: Number(row.institution_count) || 0,
      rankShare: Number(row.rank_by_share) || 0,
      rankCount: Number(row.rank_by_count) || 0,
      topCities: row.top_cities ?? "",
    });
  }

  countries.sort((a, b) => b.share - a.share);
  return countries;
}

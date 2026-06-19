import Papa from "papaparse";

export interface City {
  rank: number;
  city: string;
  country: string;
  lat: number;
  lng: number;
  count: number;
  share: number;
  institutions: number;
  topInstitutions: string;
}

export type Metric = "share" | "count";

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
      rank: Number(row.rank_by_share) || cities.length + 1,
      city: row.city?.trim() ?? "",
      country: row.country?.trim() ?? "",
      lat,
      lng,
      count: Number(row.count_sum) || 0,
      share: Number(row.share_sum) || 0,
      institutions: Number(row.institution_count) || 0,
      topInstitutions: row.top_institutions ?? "",
    });
  }

  // Sort by share desc so indexing is predictable; rank already reflects this.
  cities.sort((a, b) => b.share - a.share);
  return cities;
}

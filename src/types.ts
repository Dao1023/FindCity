// Shared types

export interface RorSlim {
  id: string;
  name: string;
  aliases: string[];      // from names[] excluding the primary name
  acronyms: string[];
  country_code: string;   // ISO-2, e.g. "US"
  country_name: string;
  city: string;
  lat: number | null;
  lng: number | null;
  types: string[];
}

export interface RorIndex {
  // country_code -> list of slim records
  byCountry: Record<string, RorSlim[]>;
  // lowercase normalized name -> list of ror ids (ambiguous forms can map to many)
  byName: Record<string, string[]>;
  total: number;
}

export interface InstitutionRow {
  Position: number;
  Institution: string;
  "Country/territory": string;
  Count: number;
  Share: number;
}

export interface MatchResult extends InstitutionRow {
  matched: boolean;
  ror_id: string | null;
  ror_name: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  match_strategy: "none" | "exact" | "alias" | "acronym" | "fuzzy";
  match_score: number; // 0..1, 1 for exact/alias
}

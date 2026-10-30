import { createServerFn } from "@tanstack/react-start";
import type { FetchResult, SearchHit } from "./ledger";
import { isValidIsin, normalizeIsin } from "./ledger";

const NAV_URL = "https://api.tigzig.com/mf/v1/nav";
const SEARCH_URL = "https://api.tigzig.com/mf/v1/search";

type RawPoint = { date?: unknown; nav?: unknown };
type RawScheme = {
  scheme_code?: unknown;
  scheme_name?: unknown;
  isin?: unknown;
  data?: RawPoint[];
};
type RawNav = {
  schemes?: RawScheme[];
  not_found?: unknown;
  not_found_hint?: unknown;
};
type RawSearch = {
  results?: Array<{
    scheme_name?: unknown;
    isin?: unknown;
    category_sub?: unknown;
    is_active?: unknown;
  }>;
};

function asIsins(input: unknown): string[] {
  if (!input || typeof input !== "object") throw new Error("Missing schemes.");
  const raw = (input as { isins?: unknown }).isins;
  if (!Array.isArray(raw) || raw.length === 0) throw new Error("Add at least one ISIN.");
  const isins = raw
    .map((v) => normalizeIsin(String(v)))
    .filter(isValidIsin);
  const unique = [...new Set(isins)].slice(0, 8);
  if (unique.length === 0) throw new Error("Those don't look like ISINs. Use 12 characters, for example INF879O01027.");
  return unique;
}

function asSince(input: unknown): string {
  const since = (input as { since?: unknown }).since;
  if (typeof since !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    throw new Error("Missing a start date.");
  }
  return since;
}

function num(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

export const fetchNavs = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ isins: asIsins(input), since: asSince(input) }))
  .handler(async ({ data }): Promise<FetchResult> => {
    const params = new URLSearchParams({
      isins: data.isins.join(","),
      since: data.since,
    });
    const res = await fetch(`${NAV_URL}?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) throw new Error("The NAV source is unavailable right now. Try again in a minute.");
    const json = (await res.json()) as RawNav;
    const schemes = (json.schemes ?? []).map((scheme) => {
      const isin = normalizeIsin(String(scheme.isin ?? ""));
      const points = (scheme.data ?? [])
        .map((point) => {
          const date = typeof point.date === "string" ? point.date : "";
          const nav = num(point.nav);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || nav == null) return null;
          return { date, nav };
        })
        .filter((point): point is { date: string; nav: number } => point != null);
      return {
        isin,
        name: typeof scheme.scheme_name === "string" ? scheme.scheme_name : isin,
        schemeCode: num(scheme.scheme_code) ?? 0,
        points,
      };
    });
    const notFound = Array.isArray(json.not_found) ? json.not_found.map((v) => String(v)) : [];
    const hint =
      notFound.length > 0
        ? "One or more ISINs were not found. Check the 12 characters — a wrong check digit will never match."
        : null;
    return { schemes, notFound, hint };
  });

export const searchSchemes = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const q = input && typeof input === "object" ? String((input as { q?: unknown }).q ?? "").trim() : "";
    if (q.length < 2) return { q: "" };
    return { q: q.slice(0, 80) };
  })
  .handler(async ({ data }): Promise<SearchHit[]> => {
    if (!data.q) return [];
    const params = new URLSearchParams({ q: data.q });
    const res = await fetch(`${SEARCH_URL}?${params}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as RawSearch;
    const hits: SearchHit[] = [];
    for (const row of json.results ?? []) {
      const isin = normalizeIsin(String(row.isin ?? ""));
      if (!isValidIsin(isin) || row.is_active === false) continue;
      hits.push({
        isin,
        name: typeof row.scheme_name === "string" ? row.scheme_name : isin,
        category: typeof row.category_sub === "string" ? row.category_sub : "",
      });
      if (hits.length === 8) break;
    }
    return hits;
  });

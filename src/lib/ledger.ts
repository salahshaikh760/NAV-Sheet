export const STORAGE_KEY = "daily-nav-sheet-v1";
export const MAX_SCHEMES = 8;
export const AUTO_REFRESH_MS = 15 * 60 * 1000;

export type PortfolioFund = { isin: string; name: string; weight: number };

// My 8-scheme portfolio. Weights are fractions and add up to 1 (100%).
// Edit this list to change the built-in portfolio.
export const DEFAULT_PORTFOLIO: PortfolioFund[] = [
  { isin: "INF03VN01506", name: "WhiteOak Capital Flexi Cap Fund", weight: 0.1 },
  { isin: "INF179K01608", name: "HDFC Flexi Cap Fund", weight: 0.15 },
  { isin: "INF247L01965", name: "Motilal Oswal Large & Midcap Fund", weight: 0.1 },
  { isin: "INF205K011T7", name: "Invesco India Small Cap Fund", weight: 0.1 },
  { isin: "INF204K01489", name: "Nippon India Multi Cap Fund", weight: 0.15 },
  { isin: "INF174KA1HS9", name: "Kotak Multicap Fund", weight: 0.15 },
  { isin: "INF194KB1AJ8", name: "Bandhan Small Cap Fund", weight: 0.1 },
  { isin: "INF179KA1RT1", name: "HDFC Mid Cap Fund", weight: 0.15 },
];

export type HistoryWindow = "30" | "90" | "270";

export type SchemeMeta = {
  isin: string;
  name: string;
  schemeCode: number;
};

export type Ledger = {
  isins: string[];
  window: HistoryWindow;
  schemes: Record<string, SchemeMeta>;
  cells: Record<string, Record<string, number>>;
  updatedAt: string | null;
};

export type NavPoint = { date: string; nav: number };

export type SchemeSeries = {
  isin: string;
  name: string;
  schemeCode: number;
  points: NavPoint[];
};

export type FetchResult = {
  schemes: SchemeSeries[];
  notFound: string[];
  hint: string | null;
};

export type SearchHit = {
  isin: string;
  name: string;
  category: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function emptyLedger(): Ledger {
  return { isins: [], window: "30", schemes: {}, cells: {}, updatedAt: null };
}

export function defaultLedger(): Ledger {
  return { ...emptyLedger(), isins: DEFAULT_PORTFOLIO.map((fund) => fund.isin) };
}

export function weightOf(isin: string): number | null {
  return DEFAULT_PORTFOLIO.find((fund) => fund.isin === isin)?.weight ?? null;
}

export function formatWeight(weight: number): string {
  return `${Math.round(weight * 1000) / 10}%`;
}

export function portfolioChange(
  dates: string[],
  cells: Ledger["cells"],
  date: string,
  isins: string[],
): number | null {
  let weightSum = 0;
  let total = 0;
  for (const isin of isins) {
    const weight = weightOf(isin);
    if (weight == null) continue;
    const change = dayChange(dates, cells, date, isin);
    if (change == null) continue;
    total += weight * change;
    weightSum += weight;
  }
  return weightSum > 0 ? total / weightSum : null;
}

export function normalizeIsin(raw: string): string {
  return raw.replace(/[^0-9a-z]/gi, "").toUpperCase();
}

export function isValidIsin(isin: string): boolean {
  return /^IN[0-9A-Z]{10}$/.test(isin);
}

export function istDate(offsetDays = 0, now = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const today = fmt.format(now);
  const [y, m, d] = today.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  return dt.toISOString().slice(0, 10);
}

export function weekday(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
}

export function formatPretty(iso: string): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1] ?? "";
  return `${Number(d)} ${month} ${y}`;
}

export function formatCellDate(iso: string, today = istDate()): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1] ?? "";
  if (y === today.slice(0, 4)) return `${Number(d)} ${month}`;
  return `${Number(d)} ${month} ${y.slice(2)}`;
}

export function formatNav(n: number): string {
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

export function formatPct(change: number): string {
  const pct = change * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

export function shortName(name: string): string {
  return name
    .replace(/\s+-\s+/g, " ")
    .replace(/Direct Plan/gi, "Direct")
    .replace(/Regular Plan/gi, "Regular")
    .replace(/\bOption\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function sortedDates(cells: Ledger["cells"]): string[] {
  return Object.keys(cells).sort();
}

export function sinceFor(ledger: Ledger, now = new Date()): string {
  const dates = sortedDates(ledger.cells);
  const days = Number(ledger.window) || 30;
  const start = istDate(-days, now);
  if (dates.length === 0) return start;
  return start < dates[0] ? start : dates[0];
}

export function windowDates(ledger: Ledger, now = new Date()): string[] {
  const start = istDate(-(Number(ledger.window) || 30), now);
  return sortedDates(ledger.cells).filter((date) => date >= start);
}

export function mergeFetch(ledger: Ledger, payload: FetchResult): Ledger {
  const schemes = { ...ledger.schemes };
  const cells: Ledger["cells"] = { ...ledger.cells };
  const keep = new Set(ledger.isins);

  for (const series of payload.schemes) {
    if (!keep.has(series.isin)) continue;
    schemes[series.isin] = {
      isin: series.isin,
      name: series.name,
      schemeCode: series.schemeCode,
    };
    for (const point of series.points) {
      const row = { ...(cells[point.date] ?? {}) };
      row[series.isin] = point.nav;
      cells[point.date] = row;
    }
  }

  for (const date of Object.keys(cells)) {
    const next: Record<string, number> = {};
    for (const isin of Object.keys(cells[date])) {
      if (keep.has(isin)) next[isin] = cells[date][isin];
    }
    if (Object.keys(next).length === 0) delete cells[date];
    else cells[date] = next;
  }

  return { ...ledger, schemes, cells, updatedAt: new Date().toISOString() };
}

export function keepLatestDateOnly(ledger: Ledger): Ledger {
  const dates = sortedDates(ledger.cells);
  if (dates.length === 0) return ledger;
  const latest = dates[dates.length - 1];
  return { ...ledger, cells: { [latest]: ledger.cells[latest] } };
}

export function dayChange(dates: string[], cells: Ledger["cells"], date: string, isin: string): number | null {
  const index = dates.indexOf(date);
  if (index <= 0) return null;
  const current = cells[date]?.[isin];
  if (current == null) return null;
  for (let i = index - 1; i >= 0; i--) {
    const prev = cells[dates[i]]?.[isin];
    if (prev != null && prev !== 0) return (current - prev) / prev;
  }
  return null;
}

export function latestDate(ledger: Ledger): string | null {
  const dates = sortedDates(ledger.cells);
  return dates.length ? dates[dates.length - 1] : null;
}

export function marketNote(latest: string | null, now = new Date()): string {
  if (!latest) return "Add your ISINs. Each market day, a new row is added underneath with that day's NAV.";
  const today = istDate(0, now);
  const pretty = formatPretty(latest);
  if (latest >= today) return `Sheet is current through ${pretty}.`;
  const [y, m, d] = today.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (wd === 0 || wd === 6) {
    return `Latest row is ${pretty}. Markets are closed today — the next row appears on the next business day.`;
  }
  return `Latest row is ${pretty}. Today's NAV is added once AMFI publishes it, usually by 11 pm IST.`;
}

export function loadLedger(): Ledger {
  if (typeof localStorage === "undefined") return emptyLedger();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultLedger();
    const parsed = JSON.parse(raw) as Partial<Ledger>;
    const window: HistoryWindow =
      parsed.window === "90" || parsed.window === "270" || parsed.window === "30" ? parsed.window : "30";
    const isins = Array.isArray(parsed.isins)
      ? parsed.isins.map((v) => normalizeIsin(String(v))).filter(isValidIsin).slice(0, MAX_SCHEMES)
      : [];
    if (isins.length === 0) return defaultLedger();
    return {
      isins,
      window,
      schemes: parsed.schemes && typeof parsed.schemes === "object" ? parsed.schemes : {},
      cells: parsed.cells && typeof parsed.cells === "object" ? parsed.cells : {},
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return defaultLedger();
  }
}

export function saveLedger(ledger: Ledger): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
}

export function colLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

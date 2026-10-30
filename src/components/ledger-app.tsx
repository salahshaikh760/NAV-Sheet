import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Download, LoaderCircle, Pencil, RefreshCw, Search, X } from "lucide-react";
import {
  AUTO_REFRESH_MS,
  MAX_SCHEMES,
  colLetter,
  DEFAULT_PORTFOLIO,
  dayChange,
  emptyLedger,
  formatWeight,
  formatCellDate,
  formatNav,
  formatPct,
  formatPretty,
  isValidIsin,
  latestDate,
  loadLedger,
  marketNote,
  mergeFetch,
  normalizeIsin,
  portfolioChange,
  saveLedger,
  shortName,
  sinceFor,
  sortedDates,
  weekday,
  weightOf,
  windowDates,
  type HistoryWindow,
  type Ledger,
  type SearchHit,
} from "@/lib/ledger";
import { fetchNavs, searchSchemes } from "@/lib/nav-api";
import { buildNavWorkbook, downloadWorkbook } from "@/lib/xlsx-nav";

const WINDOWS: { id: HistoryWindow; label: string; hint: string }[] = [
  { id: "30", label: "30 days", hint: "Fill the last month, then add a row each market day" },
  { id: "90", label: "90 days", hint: "Fill the last quarter, then keep adding rows" },
  { id: "270", label: "270 days", hint: "Fill the last 9 months, then keep adding rows" },
];

function errorText(err: unknown): string {
  if (err instanceof Error && err.message && !err.message.startsWith("[")) return err.message;
  return "Could not refresh NAVs. Check your connection and try again.";
}

export function LedgerApp() {
  const [ledger, setLedger] = useState<Ledger>(emptyLedger);
  const [editing, setEditing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<string[]>([]);
  const [active, setActive] = useState<{ date: string; isin: string } | null>(null);
  const pulling = useRef(false);
  const ledgerRef = useRef<Ledger | null>(null);
  const editingRef = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  ledgerRef.current = ledger;
  editingRef.current = editing;

  useEffect(() => {
    const loaded = loadLedger();
    if (loaded.isins.length === 0) return;
    setLedger(loaded);
    setEditing(false);
  }, []);

  const isinKey = ledger?.isins.join(",") ?? "";
  const historyKey = ledger?.window ?? "30";

  useEffect(() => {
    const current = ledgerRef.current;
    if (!current || current.isins.length === 0) return;
    const age = current.updatedAt ? Date.now() - Date.parse(current.updatedAt) : Number.POSITIVE_INFINITY;
    if (age < AUTO_REFRESH_MS && sortedDates(current.cells).length > 0) return;
    void pull(current, false);
    // pull is stable enough for this boot/key change; isin list and window are the triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isinKey, historyKey]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const current = ledgerRef.current;
      if (!current || current.isins.length === 0) return;
      const age = current.updatedAt ? Date.now() - Date.parse(current.updatedAt) : Number.POSITIVE_INFINITY;
      if (age < AUTO_REFRESH_MS) return;
      void pull(current, false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const current = ledgerRef.current;
      if (!current || editingRef.current || current.isins.length === 0) return;
      const age = current.updatedAt ? Date.now() - Date.parse(current.updatedAt) : Number.POSITIVE_INFINITY;
      if (age < AUTO_REFRESH_MS) return;
      void pull(current, false);
    }, 30 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const dates = useMemo(() => (ledger ? sortedDates(ledger.cells) : []), [ledger]);
  const shown = useMemo(() => (ledger ? windowDates(ledger) : []), [ledger]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || editing) return;
    el.scrollTop = el.scrollHeight;
  }, [shown.length, editing, isinKey]);

  async function pull(base: Ledger, manual: boolean) {
    if (base.isins.length === 0) return;
    if (pulling.current) return;
    pulling.current = true;
    setBusy(true);
    if (manual) setError(null);
    try {
      const result = await fetchNavs({ data: { isins: base.isins, since: sinceFor(base) } });
      const next = mergeFetch(base, result);
      setLedger(next);
      saveLedger(next);
      setNotFound(result.notFound);
      setError(result.schemes.length === 0 && result.notFound.length > 0 ? result.hint : null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      pulling.current = false;
      setBusy(false);
    }
  }

  function commit(next: Ledger, refresh: boolean) {
    setLedger(next);
    saveLedger(next);
    setEditing(next.isins.length === 0);
    if (refresh && next.isins.length > 0) void pull(next, true);
  }

  const latest = latestDate(ledger);
  const hasSheet = ledger.isins.length > 0 && !editing;

  return (
    <main className="flex h-dvh flex-col bg-bg text-fg">
      <SheetHeader
        actions={
          hasSheet ? (
            <>
              <button
                type="button"
                className="inline-flex h-11 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-3 text-sm font-medium"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-4" aria-hidden="true" />
                Schemes
              </button>
              <button
                type="button"
                className="inline-flex size-11 items-center justify-center rounded-md border border-line-strong bg-surface"
                onClick={() => void pull(ledger, true)}
                disabled={busy}
                aria-label="Refresh NAVs"
              >
                {busy ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <RefreshCw className="size-4" aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="inline-flex h-11 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-semibold text-accent-ink"
                onClick={() => downloadWorkbook(
                    buildNavWorkbook({ ...ledger, cells: Object.fromEntries(shown.map((date) => [date, ledger.cells[date]])) }),
                    "daily-nav-sheet.xlsx",
                  )}
                disabled={shown.length === 0}
              >
                <Download className="size-4" aria-hidden="true" />
                Excel
              </button>
            </>
          ) : null
        }
      />

      {editing ? (
        <SchemeEditor
          ledger={ledger}
          busy={busy}
          onCancel={ledger.isins.length > 0 ? () => setEditing(false) : undefined}
          onSave={(isins, historyWindow) => {
            const isinsChanged = isins.join(",") !== ledger.isins.join(",");
            const next: Ledger = {
              ...ledger,
              isins,
              window: historyWindow,
              updatedAt: isinsChanged || historyWindow !== ledger.window ? null : ledger.updatedAt,
            };
            commit(next, true);
          }}
          onClear={() => {
            const next = { ...ledger, cells: {}, updatedAt: null };
            commit(next, true);
          }}
        />
      ) : (
        <section className="flex min-h-0 flex-1 flex-col">
          <p className="border-b border-line px-4 py-2.5 text-sm text-muted">{marketNote(latest)}</p>
          {error ? (
            <p className="border-b border-line bg-warn-bg px-4 py-2.5 text-sm text-warn">{error}</p>
          ) : null}
          {notFound.length > 0 ? (
            <p className="border-b border-line bg-warn-bg px-4 py-2.5 text-sm text-warn">
              Not found: {notFound.join(", ")}. Fix the ISIN under Schemes.
            </p>
          ) : null}

          <div className="flex gap-2 overflow-x-auto px-4 py-3">
            {(() => {
              const totalWeight = ledger.isins.reduce((sum, isin) => sum + (weightOf(isin) ?? 0), 0);
              if (totalWeight <= 0) return null;
              const change = latest ? portfolioChange(dates, ledger.cells, latest, ledger.isins) : null;
              return (
                <div className="w-36 shrink-0 rounded-md border border-accent bg-surface px-3 py-2 text-left">
                  <span className="block truncate text-xs text-muted">My portfolio</span>
                  <span className="mt-1 block font-mono text-sm">{formatWeight(totalWeight)} weighted</span>
                  <span
                    className={
                      change == null ? "text-xs text-muted" : change >= 0 ? "text-xs text-up" : "text-xs text-down"
                    }
                  >
                    {change == null ? "No prior row" : formatPct(change)}
                  </span>
                </div>
              );
            })()}
            {ledger.isins.map((isin, index) => {
              const meta = ledger.schemes[isin];
              const last = latest ? ledger.cells[latest]?.[isin] : undefined;
              const change = latest ? dayChange(dates, ledger.cells, latest, isin) : null;
              return (
                <button
                  key={isin}
                  type="button"
                  className="w-36 shrink-0 rounded-md border border-line bg-surface px-3 py-2 text-left"
                  onClick={() => document.getElementById(`nav-col-${index}`)?.scrollIntoView({ inline: "center", block: "nearest" })}
                >
                  <span className="block truncate text-xs text-muted">{shortName(meta?.name ?? "Unresolved")}</span>
                  {weightOf(isin) != null ? (
                    <span className="block font-mono text-xs text-accent">{formatWeight(weightOf(isin) ?? 0)} weight</span>
                  ) : null}
                  <span className="mt-1 block font-mono text-sm">{last == null ? "—" : formatNav(last)}</span>
                  <span
                    className={
                      change == null ? "text-xs text-muted" : change >= 0 ? "text-xs text-up" : "text-xs text-down"
                    }
                  >
                    {change == null ? "No prior row" : formatPct(change)}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-line-strong bg-sheet">
            <div className="flex items-center gap-3 border-b border-line bg-gutter px-3 py-2">
              <span className="w-12 shrink-0 font-mono text-xs text-accent">
                {active ? cellRef(shown, ledger.isins, active) : "A1"}
              </span>
              <p className="min-w-0 truncate font-mono text-xs text-fg">{formulaText(ledger, dates, active)}</p>
            </div>
            <div ref={scroller} className="sheet-scroll min-h-0 flex-1 overflow-auto">
              {shown.length === 0 ? (
                <p className="px-4 py-8 text-sm text-muted">
                  {busy ? "Fetching NAVs…" : "No rows yet. Refresh once AMFI has published a NAV for these schemes."}
                </p>
              ) : (
                <table className="border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className="sticky top-0 left-0 z-30 w-9 min-w-9 border-r border-b border-line bg-gutter" />
                      <th className="sticky top-0 left-9 z-30 min-w-24 border-r border-b border-line bg-header px-2 py-2 text-left">
                        <span className="block font-mono text-xs text-muted">A</span>
                        <span className="block text-xs font-semibold">Date</span>
                      </th>
                      {ledger.isins.map((isin, index) => {
                        const name = shortName(ledger.schemes[isin]?.name ?? "Looking up…");
                        return (
                          <th
                            key={isin}
                            id={`nav-col-${index}`}
                            className="sticky top-0 z-20 min-w-32 border-r border-b border-line bg-header px-2 py-2 text-left"
                          >
                            <span className="block font-mono text-xs text-muted">{colLetter(index + 1)}</span>
                            <span className="block max-w-36 truncate text-xs font-semibold">{name}</span>
                            <span className="block font-mono text-xs text-muted">{isin}</span>
                            {weightOf(isin) != null ? (
                              <span className="block font-mono text-xs text-accent">{formatWeight(weightOf(isin) ?? 0)}</span>
                            ) : null}
                          </th>
                        );
                      })}
                      <th className="sticky top-0 z-20 min-w-28 border-r border-b border-line bg-header px-2 py-2 text-left">
                        <span className="block font-mono text-xs text-muted">{colLetter(ledger.isins.length + 1)}</span>
                        <span className="block text-xs font-semibold">Portfolio</span>
                        <span className="block font-mono text-xs text-muted">weighted day change</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((date, rowIndex) => {
                      const isLatest = date === latest;
                      return (
                        <tr key={date} className={isLatest ? "bg-header" : undefined}>
                          <th className="sticky left-0 z-10 border-r border-b border-line bg-gutter px-1 py-2 text-center font-mono text-xs font-normal text-muted">
                            {rowIndex + 1}
                          </th>
                          <th
                            className={`sticky left-9 z-10 border-r border-b border-line px-2 py-2 text-left font-normal ${isLatest ? "bg-header" : "bg-sheet"}`}
                          >
                            <span className="block text-xs text-muted">{weekday(date)}</span>
                            <span className="block font-mono text-xs">{formatCellDate(date)}</span>
                          </th>
                          {ledger.isins.map((isin) => {
                            const nav = ledger.cells[date]?.[isin];
                            const change = dayChange(dates, ledger.cells, date, isin);
                            const selected = active?.date === date && active?.isin === isin;
                            const tone =
                              change == null ? "" : change > 0 ? "bg-up-bg" : change < 0 ? "bg-down-bg" : "";
                            return (
                              <td
                                key={isin}
                                className={`border-r border-b border-line px-2 py-1.5 text-right align-middle ${tone} ${selected ? "ring-2 ring-accent ring-inset" : ""}`}
                                onClick={() => setActive({ date, isin })}
                              >
                                <span className="block font-mono text-xs">{nav == null ? "—" : formatNav(nav)}</span>
                                <span
                                  className={`block font-mono text-xs ${change == null ? "text-muted" : change >= 0 ? "text-up" : "text-down"}`}
                                >
                                  {change == null ? "" : formatPct(change)}
                                </span>
                              </td>
                            );
                          })}
                          {(() => {
                            const pc = portfolioChange(dates, ledger.cells, date, ledger.isins);
                            return (
                              <td className="border-r border-b border-line px-2 py-1.5 text-right align-middle">
                                <span
                                  className={`block font-mono text-xs ${pc == null ? "text-muted" : pc >= 0 ? "text-up" : "text-down"}`}
                                >
                                  {pc == null ? "—" : formatPct(pc)}
                                </span>
                              </td>
                            );
                          })()}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            <div className="flex items-center gap-2 border-t border-line bg-gutter px-2 py-1.5">
              <span className="rounded-sm bg-header px-2 py-1 text-xs font-medium">Daily NAV</span>
              <span className="text-xs text-muted">
                {shown.length === 0 ? "Empty" : `${shown.length} row${shown.length === 1 ? "" : "s"} · last ${ledger.window} days · newest at the bottom`}
              </span>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

function SheetHeader({ actions }: { actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold tracking-widest text-accent">AMFI DAILY</p>
        <h1 className="truncate text-xl font-semibold tracking-tight">NAV sheet</h1>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

function cellRef(dates: string[], isins: string[], active: { date: string; isin: string }): string {
  const row = dates.indexOf(active.date) + 1;
  const col = isins.indexOf(active.isin) + 1;
  if (row < 1 || col < 1) return "A1";
  return `${colLetter(col)}${row}`;
}

function formulaText(ledger: Ledger, dates: string[], active: { date: string; isin: string } | null): string {
  if (!active) return "Tap a NAV to inspect it. A new row is added each market day.";
  const nav = ledger.cells[active.date]?.[active.isin];
  const name = ledger.schemes[active.isin]?.name ?? active.isin;
  const change = dayChange(dates, ledger.cells, active.date, active.isin);
  const navText = nav == null ? "not published" : formatNav(nav);
  const changeText = change == null ? "" : ` · ${formatPct(change)} vs previous row`;
  return `${formatPretty(active.date)} · ${name} · ${navText}${changeText}`;
}

function SchemeEditor({
  ledger,
  busy,
  onCancel,
  onSave,
  onClear,
}: {
  ledger: Ledger;
  busy: boolean;
  onCancel?: () => void;
  onSave: (isins: string[], window: HistoryWindow) => void;
  onClear: () => void;
}) {
  const [slots, setSlots] = useState<string[]>(() => {
    const next = ledger.isins.slice(0, MAX_SCHEMES);
    while (next.length < MAX_SCHEMES) next.push("");
    return next;
  });
  const [historyWindow, setHistoryWindow] = useState<HistoryWindow>(ledger.window);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchSchemes({ data: { q } })
        .then((rows) => {
          if (!cancelled) setHits(rows);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const normalized = slots.map((slot) => normalizeIsin(slot));
  const issues = normalized.map((isin, index) => {
    if (!slots[index].trim()) return null;
    if (!isValidIsin(isin)) return "Needs 12 characters, starting with IN";
    if (normalized.indexOf(isin) !== index) return "Already added";
    return null;
  });
  const unique = [...new Set(normalized.filter(isValidIsin))];

  function addHit(isin: string) {
    setSlots((prev) => {
      if (prev.map(normalizeIsin).includes(isin)) return prev;
      const index = prev.findIndex((slot) => !slot.trim());
      if (index < 0) return prev;
      const next = prev.slice();
      next[index] = isin;
      return next;
    });
    setQuery("");
    setHits([]);
  }

  return (
    <section className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col self-center">
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <p className="max-w-xl text-sm text-muted">
          Add up to 8 mutual fund ISINs. Every market day the sheet grows by one row — the date, and each scheme’s NAV.
        </p>

        <label className="mt-4 block text-sm font-medium" htmlFor="scheme-search">
          Find a scheme
        </label>
        <div className="relative mt-1.5">
          <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted" aria-hidden="true" />
          <input
            id="scheme-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Parag Parikh flexi direct"
            className="h-11 w-full rounded-md border border-line-strong bg-surface pr-3 pl-9 text-base outline-none placeholder:text-muted focus:border-accent"
            autoComplete="off"
          />
        </div>
        {searching ? <p className="mt-2 text-xs text-muted">Searching schemes…</p> : null}
        {hits.length > 0 ? (
          <ul className="mt-2 overflow-hidden rounded-md border border-line">
            {hits.map((hit) => (
              <li key={hit.isin} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  className="flex w-full flex-col px-3 py-2.5 text-left hover:bg-header"
                  onClick={() => addHit(hit.isin)}
                >
                  <span className="text-sm">{hit.name}</span>
                  <span className="font-mono text-xs text-muted">
                    {hit.isin}
                    {hit.category ? ` · ${hit.category}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <button
          type="button"
          className="mt-4 h-11 w-full rounded-md border border-line-strong bg-surface text-sm font-medium"
          onClick={() => {
            const next = DEFAULT_PORTFOLIO.map((fund) => fund.isin);
            while (next.length < MAX_SCHEMES) next.push("");
            setSlots(next);
          }}
        >
          Use my 8-fund portfolio
        </button>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium">How far back to fill</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {WINDOWS.map((item) => {
              const selected = historyWindow === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={selected}
                  className={`h-11 rounded-md border px-2 text-sm font-medium ${selected ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface text-fg"}`}
                  onClick={() => setHistoryWindow(item.id)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">{WINDOWS.find((item) => item.id === historyWindow)?.hint}</p>
        </fieldset>

        <ol className="mt-5 space-y-2">
          {slots.map((slot, index) => {
            const isin = normalized[index];
            const known = isValidIsin(isin) ? ledger.schemes[isin]?.name : undefined;
            return (
              <li key={index}>
                <label className="mb-1 flex items-baseline justify-between text-xs text-muted" htmlFor={`isin-${index}`}>
                <span>Scheme {index + 1}</span>
                  {known || weightOf(isin) != null ? (
                    <span className="max-w-52 truncate text-fg">
                      {known ? shortName(known) : ""}
                      {weightOf(isin) != null ? `${known ? " · " : ""}${formatWeight(weightOf(isin) ?? 0)}` : ""}
                    </span>
                  ) : null}
                </label>
                <div className="flex gap-2">
                  <input
                    id={`isin-${index}`}
                    value={slot}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSlots((prev) => {
                        const next = prev.slice();
                        next[index] = value.toUpperCase();
                        return next;
                      });
                    }}
                    onPaste={(event) => {
                      const text = event.clipboardData.getData("text");
                      const parts = text.split(/[\s,;]+/).map(normalizeIsin).filter(Boolean);
                      if (parts.length < 2) return;
                      event.preventDefault();
                      setSlots((prev) => {
                        const next = prev.slice();
                        parts.slice(0, MAX_SCHEMES - index).forEach((part, offset) => {
                          next[index + offset] = part;
                        });
                        return next;
                      });
                    }}
                    placeholder="INF879O01027"
                    spellCheck={false}
                    autoComplete="off"
                    autoCapitalize="characters"
                    className="h-11 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-3 font-mono text-base tracking-wide outline-none placeholder:text-muted focus:border-accent"
                  />
                  {slot.trim() ? (
                    <button
                      type="button"
                      className="inline-flex size-11 items-center justify-center rounded-md border border-line-strong"
                      aria-label={`Clear scheme ${index + 1}`}
                      onClick={() =>
                        setSlots((prev) => {
                          const next = prev.slice();
                          next[index] = "";
                          return next;
                        })
                      }
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                {issues[index] ? <p className="mt-1 text-xs text-down">{issues[index]}</p> : null}
              </li>
            );
          })}
        </ol>

        {sortedDates(ledger.cells).length > 0 ? (
          <button type="button" className="mt-4 text-sm text-down underline-offset-2 hover:underline" onClick={onClear}>
            Clear saved rows and refill
          </button>
        ) : null}
      </div>

      <div className="flex gap-2 border-t border-line px-4 py-3">
        {onCancel ? (
          <button
            type="button"
            className="h-11 flex-1 rounded-md border border-line-strong bg-surface text-sm font-medium"
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : null}
        <button
          type="button"
          className="h-11 flex-1 rounded-md bg-accent text-sm font-semibold text-accent-ink disabled:opacity-40"
          disabled={unique.length === 0 || busy || issues.some(Boolean)}
          onClick={() => onSave(unique, historyWindow)}
        >
          {busy ? "Updating…" : ledger.isins.length > 0 ? "Update sheet" : "Build sheet"}
        </button>
      </div>
    </section>
  );
}

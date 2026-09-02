import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Radio, Search } from "lucide-react";
import {
  CATEGORY_META,
  SQUAWK_CODES,
  SQUAWK_RANGES,
  type SquawkCategory,
  type SquawkEntry,
} from "#/sim/squawk-codes";
import { seo } from "#/lib/seo";

export const Route = createFileRoute("/squawks")({
  component: SquawkReference,
  head: () =>
    seo({
      path: "/squawks",
      title: "Squawk code reference",
      description:
        "Searchable reference of aviation transponder squawk codes: emergency codes, VFR and IFR assignments, military and special-use blocks, and ATC discrete ranges, with the meaning of each.",
      breadcrumb: [{ name: "Squawk codes", path: "/squawks" }],
    }),
});

const CATEGORY_ORDER: SquawkCategory[] = [
  "emergency",
  "vfr",
  "ifr",
  "military",
  "special-use",
  "atc-discrete",
];

function SquawkReference() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<SquawkCategory | "all">("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SQUAWK_CODES.filter((e) => {
      if (active !== "all" && e.category !== active) return false;
      if (!q) return true;
      return (
        e.code.includes(q) ||
        e.label.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q)
      );
    });
  }, [query, active]);

  const grouped = useMemo(() => {
    const map = new Map<SquawkCategory, SquawkEntry[]>();
    for (const e of filtered) {
      const list = map.get(e.category) ?? [];
      list.push(e);
      map.set(e.category, list);
    }
    return map;
  }, [filtered]);

  return (
    <div className="h-screen w-screen overflow-y-auto bg-[var(--color-bg)] text-[var(--color-text)]">
      <header className="panel-header sticky top-0 z-10 flex items-center justify-between border-b border-[var(--color-line)] bg-[var(--color-panel-strong)] px-6 py-3">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="flex items-center gap-1 font-mono text-[10px] text-[var(--color-text-dim)] no-underline hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            BACK TO RADAR
          </Link>
          <div className="flex items-center gap-2 font-mono text-base font-bold tracking-wider text-[var(--color-phosphor)]">
            <Radio size={16} />
            TRANSPONDER CODE REFERENCE
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="panel flex items-center gap-1 px-2 py-1">
            <Search size={11} className="text-[var(--color-text-dim)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="code, name, keyword..."
              className="w-56 bg-transparent font-mono text-xs text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-dim)]"
            />
          </div>
          <div className="flex items-center gap-1">
            {(["all", ...CATEGORY_ORDER] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setActive(c)}
                className="rounded border px-2 py-1 font-mono text-[10px] tracking-widest uppercase"
                style={
                  active === c
                    ? c === "all"
                      ? {
                          borderColor: "#bbf7d0",
                          color: "#bbf7d0",
                          background: "rgba(187, 247, 208, 0.1)",
                        }
                      : {
                          borderColor: CATEGORY_META[c].color,
                          color: CATEGORY_META[c].color,
                          background: CATEGORY_META[c].bg,
                        }
                    : {
                        borderColor: "var(--color-line)",
                        color: "var(--color-text-dim)",
                      }
                }
              >
                {c === "all" ? "ALL" : CATEGORY_META[c].label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="space-y-8 px-6 py-6">
        {CATEGORY_ORDER.map((cat) => {
          const entries = grouped.get(cat);
          if (!entries || entries.length === 0) return null;
          const meta = CATEGORY_META[cat];
          return (
            <section key={cat}>
              <div className="mb-3 flex items-center gap-3">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{
                    background: meta.color,
                    boxShadow: `0 0 8px ${meta.color}`,
                  }}
                />
                <h2
                  className="font-mono text-sm font-bold tracking-widest"
                  style={{ color: meta.color }}
                >
                  {meta.label}
                </h2>
                <span className="font-mono text-[10px] text-[var(--color-text-dim)]">
                  {entries.length} code{entries.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {entries.map((e) => (
                  <article
                    key={e.code}
                    className="panel p-4"
                    style={{ borderColor: meta.color, background: meta.bg }}
                  >
                    <div className="mb-2 flex items-baseline justify-between">
                      <div
                        className="font-mono text-2xl font-bold tabular-nums"
                        style={{
                          color: meta.color,
                          textShadow: `0 0 12px ${meta.color}`,
                        }}
                      >
                        {e.code}
                      </div>
                      {e.region && (
                        <span className="font-mono text-[9px] tracking-widest text-[var(--color-text-dim)]">
                          {e.region}
                        </span>
                      )}
                    </div>
                    <div className="mb-2 font-mono text-xs font-bold text-[var(--color-text)]">
                      {e.label}
                    </div>
                    <p className="m-0 text-xs leading-relaxed text-[var(--color-text-dim)]">
                      {e.description}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          );
        })}

        {filtered.length === 0 && (
          <div className="py-12 text-center font-mono text-[var(--color-text-dim)]">
            no codes match — clear filters
          </div>
        )}

        <section>
          <div className="mb-3 flex items-center gap-3">
            <span className="inline-block h-3 w-3 rounded-sm bg-[var(--color-text-dim)]" />
            <h2 className="font-mono text-sm font-bold tracking-widest text-[var(--color-text-dim)]">
              CODE RANGES (REFERENCE)
            </h2>
          </div>
          <div className="panel">
            <table className="w-full font-mono text-xs">
              <thead className="bg-[var(--color-panel-strong)]">
                <tr className="text-left text-[10px] tracking-widest text-[var(--color-text-dim)]">
                  <th className="px-4 py-2">RANGE</th>
                  <th className="px-4 py-2">CATEGORY</th>
                  <th className="px-4 py-2">LABEL</th>
                  <th className="px-4 py-2">DESCRIPTION</th>
                </tr>
              </thead>
              <tbody>
                {SQUAWK_RANGES.map((r) => {
                  const meta = CATEGORY_META[r.category];
                  return (
                    <tr
                      key={r.range}
                      className="border-t border-[var(--color-line)]"
                    >
                      <td className="px-4 py-2 font-bold text-[var(--color-text)]">
                        {r.range}
                      </td>
                      <td className="px-4 py-2" style={{ color: meta.color }}>
                        {meta.label}
                      </td>
                      <td className="px-4 py-2 text-[var(--color-text)]">
                        {r.label}
                      </td>
                      <td className="px-4 py-2 text-[var(--color-text-dim)]">
                        {r.description}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="py-6 text-center font-mono text-[10px] text-[var(--color-text-dim)]">
          Reference compiled from FAA JO 7110.66E and ICAO Doc 4444.
          Display-only — verify against current authoritative source before
          operational use.
        </footer>
      </main>
    </div>
  );
}

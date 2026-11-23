import type { GenderCounts } from "@/domain/people";

/** Verteilung m/w/d als schmaler Balken mit Zahlen und Prozent. */
export function GenderSplit({ counts, label }: { counts: GenderCounts; label?: string }) {
  const total = counts.m + counts.w + counts.d + counts.unknown;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const items = [
    { k: "w", n: counts.w, cls: "bg-accent", text: "text-accent-2" },
    { k: "m", n: counts.m, cls: "bg-fg-2", text: "text-fg-2" },
    { k: "d", n: counts.d, cls: "bg-warn", text: "text-warn" },
  ];
  return (
    <div className="flex flex-col gap-1.5" data-testid="gender-split">
      {label && <span className="text-[11px] text-muted">{label}</span>}
      <div className="flex h-1.5 bg-line" role="img" aria-label={`w ${counts.w}, m ${counts.m}, d ${counts.d}`}>
        {items.map((i) => (
          <div key={i.k} className={i.cls} style={{ width: `${pct(i.n)}%` }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        {items.map((i) => (
          <span key={i.k}>
            <span className={i.text}>{i.k}</span> {i.n} <span className="text-faint">({pct(i.n)} %)</span>
          </span>
        ))}
        {counts.unknown > 0 && <span>? {counts.unknown}</span>}
      </div>
    </div>
  );
}

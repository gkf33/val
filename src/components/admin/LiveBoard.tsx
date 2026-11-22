"use client";

import { useEffect, useState } from "react";

interface Live {
  inside: number;
  capacity: number;
  checkedInTotal: number;
  expected: number;
  noShows: number;
  recent: { name: string; status: string; statusChangedAt: string; checkedInDevice: string | null; type: string }[];
}

export function LiveBoard({ partyId }: { partyId: string }) {
  const [d, setD] = useState<Live | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`/api/admin/parties/${partyId}/live`, { cache: "no-store" });
        if (!r.ok) throw new Error();
        setD(await r.json());
        setErr(false);
      } catch {
        setErr(true);
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [partyId]);

  if (!d) return <p className="text-sm text-muted">Lädt …</p>;
  const tile = (label: string, value: number, big = false) => (
    <div className="flex flex-col gap-1 border border-line p-3">
      <span className="text-[11px] tracking-wide text-muted uppercase">{label}</span>
      <span className={`${big ? "text-4xl" : "text-2xl"} font-bold`}>{value}</span>
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline gap-2">
        <span className="text-5xl font-bold" data-testid="live-inside">{d.inside}</span>
        <span className="text-xl text-muted">/ {d.capacity} drinnen</span>
        {err && <span className="ml-auto text-xs text-warn">▲ Verbindung</span>}
      </div>
      <div className="h-2 bg-line">
        <div className="h-2 bg-accent" style={{ width: `${Math.min(100, (d.inside / d.capacity) * 100)}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tile("Eingecheckt gesamt", d.checkedInTotal)}
        {tile("Erwartet", d.expected)}
        {tile("No-Shows", d.noShows)}
      </div>
      <h2 className="text-sm font-semibold">Zuletzt</h2>
      <ul className="flex flex-col divide-y divide-line border-y border-line text-sm">
        {d.recent.map((r, i) => (
          <li key={i} className="flex justify-between gap-2 py-2">
            <span>
              {r.name} {r.type === "crew" && <span className="text-[11px] text-muted">Crew</span>}
            </span>
            <span className="text-xs text-muted">
              {r.status === "checked_in" ? "rein" : "raus"} ·{" "}
              {new Date(r.statusChangedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} · {r.checkedInDevice}
            </span>
          </li>
        ))}
        {d.recent.length === 0 && <li className="py-2 text-muted">Noch niemand eingecheckt.</li>}
      </ul>
    </div>
  );
}

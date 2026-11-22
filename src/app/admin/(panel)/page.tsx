import Link from "next/link";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { occupancyByParty } from "@/server/stats";
import { formatDateTime } from "@/domain/time";
import { formatEuro } from "@/domain/money";
import { OccupancyBar } from "@/components/admin/OccupancyBar";
import { expireOverdue } from "@/server/expiry";

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Entwurf", cls: "border border-line-3 text-fg-2" },
  open: { label: "Offen", cls: "bg-accent text-on-accent" },
  closed: { label: "Geschlossen", cls: "bg-line-2 text-fg-2" },
};

function Tile({ label, value, tone }: { label: string; value: number; tone?: "accent" | "warn" }) {
  const color = tone === "accent" && value > 0 ? "text-accent-2" : tone === "warn" && value > 0 ? "text-warn" : "text-fg";
  return (
    <div className="flex flex-col gap-1 border border-line p-3">
      <span className="text-[11px] tracking-wide text-muted uppercase">{label}</span>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
    </div>
  );
}

export default async function AdminHome() {
  await expireOverdue();
  const parties = await prisma.party.findMany({ orderBy: { startsAt: "desc" } });
  const occ = await occupancyByParty(parties.map((p) => p.id));
  const [unmatched, refundsDue] = await Promise.all([
    prisma.payment.count({ where: { state: { in: ["unmatched", "suggested", "late"] } } }),
    prisma.refund.count({ where: { status: "due" } }),
  ]);
  const totals = Object.values(occ).reduce(
    (a, o) => ({ requested: a.requested + o.requested, waitlisted: a.waitlisted + o.waitlisted }),
    { requested: 0, waitlisted: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Tile label="Anfragen" value={totals.requested} tone="accent" />
        <Tile label="Warteliste" value={totals.waitlisted} />
        <Tile label="Nicht zugeordnet" value={unmatched} tone="warn" />
        <Tile label="Erstattung nötig" value={refundsDue} tone="warn" />
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Partys</h1>
        <Link href="/admin/parties/new" className="flex min-h-11 items-center bg-accent px-4 text-sm font-semibold text-on-accent no-underline">
          + Neue Party
        </Link>
      </div>

      {parties.length === 0 && <p className="text-sm text-muted">Noch keine Party angelegt.</p>}

      <ul className="flex flex-col gap-3">
        {parties.map((p) => {
          const s = STATUS[p.status];
          return (
            <li key={p.id}>
              <Link href={`/admin/parties/${p.id}`} className="flex flex-col gap-4 border border-line-2 bg-surface p-4 text-fg no-underline hover:border-accent">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-xs text-muted">
                      {formatDateTime(p.startsAt, config.timeZone)} · {formatEuro(p.feeCents)} p. P.
                    </span>
                  </div>
                  <span className={`px-2 py-1 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>
                </div>
                <OccupancyBar o={occ[p.id]} />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

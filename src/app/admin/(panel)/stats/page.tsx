import { config } from "@/server/config";
import { inviterStats, partyStatsList } from "@/server/reports";
import { formatDateTime } from "@/domain/time";
import { GenderSplit } from "@/components/admin/GenderSplit";

export const dynamic = "force-dynamic";

const pct = (r: number | null) => (r === null ? "—" : `${Math.round(r * 100)} %`);

export default async function StatsPage() {
  const [parties, inviters] = await Promise.all([partyStatsList(), inviterStats()]);
  const done = parties.filter((p) => p.over);
  const att = done.reduce((s, p) => s + p.attended, 0);
  const ns = done.reduce((s, p) => s + p.noShows, 0);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">Statistik</h1>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Partys", parties.length],
          ["Gäste da", att],
          ["No-Show-Quote", pct(att + ns ? ns / (att + ns) : null)],
        ].map(([l, v]) => (
          <div key={String(l)} className="flex flex-col gap-1 border border-line p-3">
            <span className="text-[11px] tracking-wide text-muted uppercase">{l}</span>
            <span className="text-2xl font-bold">{v}</span>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Je Party</h2>
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {parties.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 py-3 text-sm">
              <div className="flex justify-between gap-2">
                <span>
                  {p.name} <span className="text-xs text-muted">{formatDateTime(p.startsAt, config.timeZone)}</span>
                </span>
                <span className="text-xs text-fg-2">
                  {p.attended} da · {p.noShows} No-Shows · {pct(p.noShowRate)}
                </span>
              </div>
              {p.attended > 0 && <GenderSplit counts={p.genders} />}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Einlader-Netzwerk</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-[11px] text-muted uppercase">
              <tr>
                <th className="py-1">Über</th>
                <th className="py-1 text-right">Partys</th>
                <th className="py-1 text-right">Anfragen</th>
                <th className="py-1 text-right">Gäste</th>
                <th className="py-1 text-right">Da</th>
                <th className="py-1 text-right">No-Show</th>
              </tr>
            </thead>
            <tbody>
              {inviters.map((i) => (
                <tr key={i.label} className="border-t border-line">
                  <td className="py-1.5">{i.label}</td>
                  <td className="py-1.5 text-right">{i.parties}</td>
                  <td className="py-1.5 text-right">{i.bookings}</td>
                  <td className="py-1.5 text-right">{i.guests}</td>
                  <td className="py-1.5 text-right">{i.attended}</td>
                  <td className="py-1.5 text-right">{pct(i.noShowRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

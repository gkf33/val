import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { accountHistory } from "@/server/reports";
import { findMatches } from "@/domain/people";
import { formatDateTime } from "@/domain/time";
import { blockAccountAction, toggleTrustedAction } from "@/app/admin/phase5Actions";

export const dynamic = "force-dynamic";

export default async function GuestsPage({ searchParams }: { searchParams: Promise<{ q?: string; f?: string }> }) {
  const { q, f } = await searchParams;
  const term = q?.trim();
  const accounts = await prisma.account.findMany({
    where: {
      ...(f === "trusted" ? { trusted: true } : {}),
      ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const [history, blocklist] = await Promise.all([accountHistory(accounts.map((a) => a.id)), prisma.blocklist.findMany()]);
  const blockRefs = blocklist.map((b) => ({ name: b.name ?? "", email: b.email }));
  const admins = new Set(config.adminEmails);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Gäste</h1>
      <p className="text-xs text-muted">
        Konten wiederkehrender Gäste mit Historie. „Vertraut“ = automatische Freigabe, wenn TRUSTED_AUTO_APPROVE aktiv ist
        ({config.flags.trustedAutoApprove ? "aktiv" : "aus"}).
      </p>
      <form className="flex flex-wrap gap-2">
        <label htmlFor="gq" className="sr-only">Suche</label>
        <input id="gq" name="q" defaultValue={q} placeholder="Name oder E-Mail" className="min-h-11 min-w-0 flex-1 border border-line-2 bg-surface-2 px-3 text-sm" />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="f" value="trusted" defaultChecked={f === "trusted"} className="size-5" /> nur vertraute
        </label>
        <button className="min-h-11 border border-line-3 px-3 text-sm">Filtern</button>
      </form>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {accounts.map((a) => {
          const h = history[a.id] ?? { bookings: 0, attended: 0, noShows: 0, firstVia: null };
          const blocked = findMatches([{ name: a.name ?? "", email: a.email }], blockRefs).length > 0;
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                {a.name ?? "—"} {a.trusted && <span className="ml-1 text-[11px] text-accent-2">vertraut</span>}
                {blocked && <span className="ml-1 text-[11px] text-bad">gesperrt</span>}
                {admins.has(a.email) && <span className="ml-1 text-[11px] text-muted">admin</span>}
                <span className="block text-[11px] text-muted">
                  {a.email} · {h.attended} da · {h.noShows} No-Shows · {h.bookings} Anfragen
                  {h.firstVia && ` · kam über ${h.firstVia}`} · seit {formatDateTime(a.createdAt, config.timeZone)}
                </span>
              </span>
              <form action={toggleTrustedAction.bind(null, a.id)}>
                <button className="min-h-11 border border-line-3 px-2.5 text-xs hover:border-accent">{a.trusted ? "Nicht vertraut" : "Vertraut"}</button>
              </form>
              {!blocked && (
                <form action={blockAccountAction.bind(null, a.id)}>
                  <button className="min-h-11 px-2 text-xs text-bad underline">Sperren</button>
                </form>
              )}
            </li>
          );
        })}
        {accounts.length === 0 && <li className="py-3 text-sm text-muted">Keine Konten.</li>}
      </ul>
    </div>
  );
}

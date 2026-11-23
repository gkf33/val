import Link from "next/link";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { loadQueue, type QueueBooking } from "@/server/queue";
import { capacitySnapshot } from "@/server/capacity";
import { expireOverdue } from "@/server/expiry";
import { formatDateTime } from "@/domain/time";
import { formatEuro } from "@/domain/money";
import { queueAction } from "@/app/admin/actions";
import { occupancyByParty } from "@/server/stats";
import { GenderSplit } from "@/components/admin/GenderSplit";

export const dynamic = "force-dynamic";

function ago(d: Date): string {
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 60) return `vor ${Math.max(1, min)} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `vor ${h} h`;
  return `vor ${Math.round(h / 24)} Tagen`;
}

function Card({ b, tab }: { b: QueueBooking; tab: string }) {
  const warn = b.bookingWarnings.length > 0 || b.guests.some((g) => g.warnings.length > 0);
  const block = b.bookingWarnings.some((w) => w.kind === "blocklist") || b.guests.some((g) => g.warnings.some((w) => w.kind === "blocklist"));
  return (
    <li className={`flex flex-col gap-3 border bg-surface p-4 ${block ? "border-bad" : warn ? "border-[#5a4a1e]" : "border-line-2"}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-semibold">
          {b.bookerName}
          {b.guests.length > 1 || !b.bookerAttends ? <span className="text-fg-2"> · {b.guests.length} P.</span> : null}
        </span>
        <span className="shrink-0 text-[11px] text-muted">{ago(b.confirmedAt)}</span>
      </div>
      <p className="text-xs text-fg-2">
        via {b.via} · {b.history.parties === 0 ? "erste Party" : `${b.history.attended} Partys · ${b.history.noShows} No-Shows`}
        {b.trusted && <span className="ml-2 text-accent-2">vertraut</span>}
      </p>
      <p className="text-[11px] text-muted">
        {b.email} · Ref {b.referenceCode}
        {!b.bookerAttends && " · Bucher kommt nicht selbst"}
      </p>
      {b.bookingWarnings.map((w, i) => (
        <p key={i} className={`text-xs ${w.kind === "blocklist" ? "text-bad" : "text-warn"}`}>▲ {w.text}</p>
      ))}
      <ul className="flex flex-col">
        {b.guests.map((g) => (
          <li key={g.id} className="flex flex-col">
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" name="guest" value={`${b.id}:${g.id}`} defaultChecked={g.warnings.length === 0} className="size-5 shrink-0" />
              <span>{g.name}</span>
              <span className={`w-5 text-center text-xs font-semibold ${g.gender === "w" ? "text-accent-2" : g.gender === "d" ? "text-warn" : "text-fg-2"}`}>
                {g.gender ?? "?"}
              </span>
              {g.isBooker && <span className="text-[11px] text-muted">Bucher</span>}
              {g.status === "waitlisted" && tab !== "waitlist" && <span className="text-[11px] text-muted">Warteliste</span>}
            </label>
            {g.warnings.map((w, i) => (
              <p key={i} className={`pl-8 text-xs ${w.kind === "blocklist" ? "text-bad" : "text-warn"}`}>▲ {w.text}</p>
            ))}
          </li>
        ))}
      </ul>
      <details className="text-xs">
        <summary className="min-h-9 cursor-pointer py-2 text-muted">Nachricht bei Ablehnung</summary>
        <label htmlFor={`msg-${b.id}`} className="sr-only">Nachricht</label>
        <textarea id={`msg-${b.id}`} name={`msg-${b.id}`} rows={2} className="w-full border border-line-2 bg-surface-2 p-2 text-sm" />
      </details>
      <div className="grid grid-cols-3 gap-2">
        <button name="op" value={`approve:${b.id}`} className="col-span-1 min-h-11 bg-accent text-sm font-semibold text-on-accent hover:bg-accent-2">
          Freigeben
        </button>
        {tab !== "waitlist" ? (
          <button name="op" value={`waitlist:${b.id}`} className="min-h-11 border border-line-3 text-sm hover:border-accent">
            Warteliste
          </button>
        ) : (
          <span />
        )}
        <button name="op" value={`reject:${b.id}`} className="min-h-11 border border-line-3 text-sm hover:border-bad">
          Ablehnen
        </button>
      </div>
    </li>
  );
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ party?: string; tab?: string; ok?: string; err?: string }>;
}) {
  const sp = await searchParams;
  const parties = await prisma.party.findMany({ where: { status: { not: "draft" } }, orderBy: { startsAt: "asc" } });
  const now = new Date();
  const party = parties.find((p) => p.id === sp.party) ?? parties.find((p) => p.endsAt > now) ?? parties.at(-1);
  if (!party) return <p className="text-sm text-muted">Keine offene Party.</p>;
  const tab = sp.tab === "waitlist" ? "waitlist" : "requested";

  await expireOverdue(now, party.id);
  const stats = (await occupancyByParty([party.id]))[party.id];
  const [queue, snap, counts] = await Promise.all([
    loadQueue(party.id, tab === "waitlist" ? ["waitlisted"] : ["requested"]),
    capacitySnapshot(prisma, party.id),
    prisma.guest.groupBy({ by: ["status"], where: { partyId: party.id, status: { in: ["requested", "waitlisted"] } }, _count: { _all: true } }),
  ]);
  const n = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const tz = config.timeZone;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Freigabe</h1>
        <form className="flex items-center gap-2">
          <label htmlFor="party" className="sr-only">Party</label>
          <select id="party" name="party" defaultValue={party.id} className="min-h-11 border border-line-2 bg-surface-2 px-2 text-sm">
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {formatDateTime(p.startsAt, tz)}
              </option>
            ))}
          </select>
          <button className="min-h-11 border border-line-3 px-3 text-sm">Wechseln</button>
        </form>
      </div>

      <p className="text-sm text-fg-2">
        Frei: <span className="font-semibold text-fg">{snap.free}</span> / {snap.capacity} · Beitrag {formatEuro(party.feeCents)} p. P. · Frist{" "}
        {party.paymentDeadlineMinutes} min
      </p>

      <div className="grid gap-3 border border-line p-3 sm:grid-cols-2">
        <GenderSplit counts={stats.genders} label="Belegt (freigegeben, bezahlt, Crew)" />
        <GenderSplit counts={stats.requestedGenders} label="Angefragt + Warteliste" />
      </div>

      <nav className="flex gap-2 text-sm">
        {[
          { key: "requested", label: `Anfragen (${n("requested")})` },
          { key: "waitlist", label: `Warteliste (${n("waitlisted")})` },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/admin/queue?party=${party.id}&tab=${t.key}`}
            className={`flex min-h-11 items-center px-3 no-underline ${tab === t.key ? "bg-accent text-on-accent" : "border border-line-3 text-fg"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {sp.ok && <p className="border border-ok p-3 text-sm text-ok-2">✓ {sp.ok}</p>}
      {sp.err && <p className="border border-warn p-3 text-sm text-warn">▲ {sp.err}</p>}

      {queue.length === 0 ? (
        <p className="text-sm text-muted">{tab === "waitlist" ? "Warteliste leer." : "Keine offenen Anfragen."}</p>
      ) : (
        <form action={queueAction.bind(null, party.id, tab)} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2 border border-line p-3 text-sm">
            <span className="mr-auto text-xs text-muted">Alle markierten Gäste:</span>
            <button name="op" value="approve" className="min-h-11 bg-accent px-4 font-semibold text-on-accent">Freigeben</button>
            {tab !== "waitlist" && (
              <button name="op" value="waitlist" className="min-h-11 border border-line-3 px-4">Warteliste</button>
            )}
            <button name="op" value="reject" className="min-h-11 border border-line-3 px-4">Ablehnen</button>
          </div>
          <ul className="flex flex-col gap-3">
            {queue.map((b) => (
              <Card key={b.id} b={b} tab={tab} />
            ))}
          </ul>
        </form>
      )}
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { partyUrl } from "@/server/parties";
import { occupancyByParty } from "@/server/stats";
import { utcToLocalInput, formatDateTime } from "@/domain/time";
import { PartyForm } from "@/components/admin/PartyForm";
import { OccupancyBar } from "@/components/admin/OccupancyBar";
import { GenderSplit } from "@/components/admin/GenderSplit";
import { CopyButton } from "@/components/CopyButton";
import { DoorSection } from "@/components/admin/DoorSection";
import {
  createInviterLinkAction,
  createPublicLinkAction,
  deactivateLinkAction,
  regenerateLinkAction,
  updatePartyAction,
} from "@/app/admin/actions";

export default async function PartyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doorErr?: string }> }) {
  const { id } = await params;
  const { doorErr } = await searchParams;
  const party = await prisma.party.findUnique({
    where: { id },
    include: { links: { where: { type: { in: ["public", "inviter"] } }, orderBy: { createdAt: "asc" } } },
  });
  if (!party) notFound();
  const occ = (await occupancyByParty([party.id]))[party.id];
  const tz = config.timeZone;
  const active = party.links.filter((l) => l.active);
  const inactive = party.links.filter((l) => !l.active);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{party.name}</h1>
        <p className="text-xs text-muted">{formatDateTime(party.startsAt, tz)} – {formatDateTime(party.endsAt, tz)}</p>
      </div>

      <section className="flex flex-col gap-4 border border-line p-4">
        <OccupancyBar o={occ} />
        <GenderSplit counts={occ.genders} label="Belegt nach Geschlecht" />
        <GenderSplit counts={occ.requestedGenders} label="Angefragt + Warteliste nach Geschlecht" />
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={`/admin/queue?party=${party.id}`} className="flex min-h-11 items-center border border-line-3 px-3 text-fg no-underline hover:border-accent">
            Anfragen ({occ.requested})
          </Link>
          <Link href={`/admin/queue?party=${party.id}&tab=waitlist`} className="flex min-h-11 items-center border border-line-3 px-3 text-fg no-underline hover:border-accent">
            Warteliste ({occ.waitlisted})
          </Link>
          <Link href={`/admin/parties/${party.id}/crew`} className="flex min-h-11 items-center border border-line-3 px-3 text-fg no-underline hover:border-accent">
            Crew ({occ.crew})
          </Link>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Links</h2>
        {party.status === "draft" && (
          <p className="text-xs text-warn">▲ Party ist im Entwurf. Links zeigen erst nach „Offen“ etwas an.</p>
        )}
        <ul className="flex flex-col gap-2">
          {active.map((l) => {
            const url = partyUrl(party.slug, l.code);
            return (
              <li key={l.id} className="flex flex-col gap-2 border border-line-2 bg-surface p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-fg-2">{l.type === "public" ? "Party-Link" : `Einlader: ${l.inviterLabel}`}</span>
                  <span className="text-muted">seit {formatDateTime(l.createdAt, tz)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg">{url}</code>
                  <CopyButton value={url} />
                </div>
                <div className="flex gap-2">
                  <form action={regenerateLinkAction.bind(null, party.id, l.id)}>
                    <button className="min-h-11 text-xs text-fg-2 underline hover:text-fg">Neu erzeugen</button>
                  </form>
                  <form action={deactivateLinkAction.bind(null, party.id, l.id)}>
                    <button className="min-h-11 text-xs text-warn underline">Deaktivieren</button>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row">
          <form action={createInviterLinkAction.bind(null, party.id)} className="flex flex-1 gap-2">
            <label htmlFor="inviterLabel" className="sr-only">Einlader</label>
            <input
              id="inviterLabel"
              name="inviterLabel"
              placeholder="Einlader, z. B. Jonas"
              required
              className="min-h-11 min-w-0 flex-1 rounded-[2px] border border-line-2 bg-surface-2 px-3 text-sm"
            />
            <button className="min-h-11 shrink-0 border border-line-3 px-3 text-sm hover:border-accent">+ Einlader-Link</button>
          </form>
          {!active.some((l) => l.type === "public") && (
            <form action={createPublicLinkAction.bind(null, party.id)}>
              <button className="min-h-11 border border-line-3 px-3 text-sm hover:border-accent">+ Party-Link</button>
            </form>
          )}
        </div>
        {inactive.length > 0 && (
          <details className="text-xs text-muted">
            <summary className="min-h-11 cursor-pointer py-3">{inactive.length} deaktivierte Links</summary>
            <ul className="flex flex-col gap-1">
              {inactive.map((l) => (
                <li key={l.id} className="font-mono line-through">
                  {l.type === "public" ? "Party-Link" : l.inviterLabel} · …{l.code.slice(-4)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <DoorSection partyId={party.id} error={doorErr} />

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Einstellungen</h2>
        <PartyForm
          action={updatePartyAction.bind(null, party.id)}
          submitLabel="Speichern"
          initial={{
            name: party.name,
            status: party.status,
            startsAt: utcToLocalInput(party.startsAt, tz),
            endsAt: utcToLocalInput(party.endsAt, tz),
            registrationClosesAt: party.registrationClosesAt ? utcToLocalInput(party.registrationClosesAt, tz) : "",
            paymentsAcceptedUntil: party.paymentsAcceptedUntil ? utcToLocalInput(party.paymentsAcceptedUntil, tz) : "",
            paymentDeadlineMinutes: party.paymentDeadlineMinutes,
            capacity: party.capacity,
            fee: (party.feeCents / 100).toFixed(2).replace(".", ","),
            maxGroupSize: party.maxGroupSize,
            city: party.city ?? "",
            address: party.address ?? "",
            directions: party.directions ?? "",
            info: party.info ?? "",
            transparencyPublic: party.transparencyPublic,
          }}
        />
      </section>
    </div>
  );
}

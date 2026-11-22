import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { resolvePartyLink } from "@/server/parties";
import { capacitySnapshot } from "@/server/capacity";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { formatDate, formatTime } from "@/domain/time";
import { formatEuro } from "@/domain/money";
import { isRegistrationOpen } from "@/domain/deadlines";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "_", robots: { index: false, follow: false } };

function Cell({ label, children, wide, accent }: { label: string; children: React.ReactNode; wide?: boolean; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 bg-surface p-3 ${wide ? "col-span-2" : ""}`}>
      <span className="text-[11px] text-muted">{label}</span>
      <span className={`text-[15px] ${accent ? "text-accent" : ""}`}>{children}</span>
    </div>
  );
}

export default async function PartyPage({ params }: { params: Promise<{ segment: string }> }) {
  const { segment } = await params;
  const link = await resolvePartyLink(segment);
  if (!link) notFound();
  const { party } = link;
  const tz = config.timeZone;
  const snap = await capacitySnapshot(prisma, party.id);
  const open = party.status === "open" && isRegistrationOpen(party, new Date());

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-7 px-5 py-7">
      <div className="flex flex-col gap-1.5 text-[13px] text-muted">
        <p>
          PS&gt; invite --resolve <span className="text-accent">{link.code.slice(0, 3).toUpperCase()}-{link.code.slice(3, 6).toUpperCase()}</span>
        </p>
        <p>einladung gültig. zugang nur auf freigabe.</p>
        {link.inviterLabel && <p>via {link.inviterLabel}.</p>}
      </div>

      <h1 className="text-[30px] leading-tight font-bold tracking-tight">
        Du wurdest
        <br />
        eingeladen.
      </h1>

      <div className="grid grid-cols-2 gap-px border border-line bg-line">
        <Cell label="DATUM">{formatDate(party.startsAt, tz)}</Cell>
        <Cell label="ZEIT">
          {formatTime(party.startsAt, tz)} – {formatTime(party.endsAt, tz)}
        </Cell>
        <Cell label="UNKOSTENBEITRAG">{formatEuro(party.feeCents)}</Cell>
        <Cell label="PLÄTZE" accent>
          {snap.free > 0 ? `noch ${snap.free}` : "ausgebucht"}
        </Cell>
        <Cell label="ORT" wide>
          {party.city ? `${party.city} · ` : "██████ · "}kommt mit dem QR-Code
        </Cell>
      </div>

      {party.info && <p className="text-sm leading-relaxed whitespace-pre-line text-fg-2">{party.info}</p>}

      {open ? (
        <div className="flex flex-col gap-3 border border-dashed border-line-3 p-4 text-sm text-fg-2">
          <p className="text-xs text-muted">{"// anfrage"}</p>
          <p>Formular folgt. (Phase 2)</p>
        </div>
      ) : (
        <p className="text-sm text-muted">Anmeldung geschlossen.</p>
      )}

      <p className="mt-auto text-center text-[11px] text-faint">nicht weitergeben. qr-codes sind nicht übertragbar.</p>
    </main>
  );
}

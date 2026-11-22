import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { qrSvg, verifyTicketPayload } from "@/server/tickets";
import { formatDate, formatTime } from "@/domain/time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "QR-Code", robots: { index: false, follow: false } };

const VALID = ["paid", "checked_in", "checked_out"];

export default async function TicketPage({ params }: { params: Promise<{ payload: string }> }) {
  const { payload } = await params;
  const token = verifyTicketPayload(decodeURIComponent(payload));
  if (!token) notFound();
  const guest = await prisma.guest.findUnique({ where: { ticketToken: token }, include: { party: true } });
  if (!guest) notFound();
  const valid = VALID.includes(guest.status);
  const tz = config.timeZone;
  const svg = valid ? await qrSvg(token) : null;
  const p = guest.party;
  const maps = p.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}` : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-5 py-7">
      <div className="flex justify-between text-xs text-muted">
        <span>PS&gt; qr --show</span>
        <span className={valid ? "text-accent" : "text-warn"}>● {valid ? "gültig" : "ungültig"}</span>
      </div>
      <section className="flex flex-col border border-line-2 bg-surface">
        <div className="flex flex-col gap-1.5 p-5">
          <span className="text-[11px] text-muted">EINLASS FÜR</span>
          <span className="text-2xl font-bold break-words">{guest.name}</span>
          {guest.type === "crew" && <span className="self-start bg-fg px-2 py-0.5 text-xs font-bold text-bg">CREW{guest.role ? ` · ${guest.role}` : ""}</span>}
          <span className="text-xs text-fg-2">Ausweis bereithalten.</span>
        </div>
        {svg ? (
          <div className="mx-5 bg-white p-4" aria-label="QR-Code" role="img" dangerouslySetInnerHTML={{ __html: svg }} />
        ) : (
          <p className="mx-5 border border-warn p-4 text-sm text-warn">Dieser QR-Code ist nicht (mehr) gültig.</p>
        )}
        <div className="grid grid-cols-2 gap-3.5 p-5">
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">DATUM</span>
            <span className="text-sm">{formatDate(p.startsAt, tz)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] text-muted">EINLASS</span>
            <span className="text-sm">ab {formatTime(p.startsAt, tz)}</span>
          </div>
          {valid && (
            <div className="col-span-2 flex flex-col gap-1">
              <span className="text-[11px] text-muted">ORT</span>
              <span className="text-sm whitespace-pre-line">{p.address ?? "folgt"}</span>
              {p.directions && <span className="text-xs whitespace-pre-line text-fg-2">{p.directions}</span>}
              {maps && (
                <a href={maps} className="flex min-h-11 items-center text-sm">
                  anfahrt öffnen ▸
                </a>
              )}
            </div>
          )}
        </div>
      </section>
      {valid && (
        <p className="flex items-center gap-2.5 border border-dashed border-line-3 p-3 text-xs text-fg-2">
          <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
          Bildschirmhelligkeit hoch.
        </p>
      )}
      <p className="mt-auto text-center text-[11px] text-faint">nicht übertragbar · einmal gültig</p>
    </main>
  );
}

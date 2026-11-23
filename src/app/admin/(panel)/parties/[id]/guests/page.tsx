import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { STATUS_LABEL, type GuestStatus } from "@/domain/guestStatus";
import { adminCancelAction } from "@/app/admin/phase5Actions";

export const dynamic = "force-dynamic";

const CANCELLABLE = ["requested", "waitlisted", "approved_unpaid", "payment_mismatch", "paid"];

export default async function PartyGuests({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; err?: string }> }) {
  const { id } = await params;
  const { q, err } = await searchParams;
  const party = await prisma.party.findUnique({ where: { id } });
  if (!party) notFound();
  const guests = await prisma.guest.findMany({
    where: { partyId: id, status: { not: "pending_email" }, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
    include: { booking: { select: { id: true, referenceCode: true, bookerName: true, viaLink: { select: { type: true, inviterLabel: true } } } } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  return (
    <div className="flex flex-col gap-4">
      <Link href={`/admin/parties/${id}`} className="text-xs text-muted no-underline">← {party.name}</Link>
      <h1 className="text-lg font-semibold">Gästeliste ({guests.length})</h1>
      <form className="flex gap-2">
        <label htmlFor="q" className="sr-only">Suche</label>
        <input id="q" name="q" defaultValue={q} placeholder="Name suchen" className="min-h-11 flex-1 border border-line-2 bg-surface-2 px-3 text-sm" />
        <button className="min-h-11 border border-line-3 px-3 text-sm">Suchen</button>
      </form>
      {err && <p className="border border-warn p-3 text-sm text-warn">▲ {err}</p>}
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {guests.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            <span className="min-w-0 flex-1">
              {g.name} <span className="text-xs text-muted">{g.gender ?? ""}</span>
              {g.type === "crew" && <span className="ml-2 bg-line-2 px-1.5 text-[11px]">Crew{g.role ? ` · ${g.role}` : ""}</span>}
              <span className="block text-[11px] text-muted">
                {STATUS_LABEL[g.status as GuestStatus]}
                {g.booking && ` · ${g.booking.referenceCode} · Bucher ${g.booking.bookerName}`}
                {g.booking?.viaLink?.type === "inviter" && ` · via ${g.booking.viaLink.inviterLabel}`}
              </span>
            </span>
            {g.booking && CANCELLABLE.includes(g.status) && (
              <form action={adminCancelAction.bind(null, id, g.booking.id, g.id)}>
                <button className="min-h-11 px-2 text-xs text-warn underline">Stornieren</button>
              </form>
            )}
          </li>
        ))}
        {guests.length === 0 && <li className="py-3 text-sm text-muted">Keine Gäste.</li>}
      </ul>
    </div>
  );
}

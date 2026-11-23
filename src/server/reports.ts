/**
 * Auswertungen: Finanzen je Party (Transparenz), No-Shows, Einlader-Netzwerk.
 */
import type { GuestStatus } from "@prisma/client";
import { prisma } from "./db";

const ATTENDED: GuestStatus[] = ["checked_in", "checked_out"];

export async function partyFinance(partyId: string) {
  const [income, refunds, costs] = await Promise.all([
    prisma.payment.aggregate({ where: { state: "matched", matchedBooking: { partyId } }, _sum: { grossCents: true } }),
    prisma.refund.aggregate({ where: { booking: { partyId } }, _sum: { amountCents: true } }),
    prisma.partyCost.findMany({ where: { partyId }, orderBy: { createdAt: "asc" } }),
  ]);
  const incomeCents = income._sum.grossCents ?? 0;
  const refundCents = refunds._sum.amountCents ?? 0;
  const costCents = costs.reduce((s, c) => s + c.amountCents, 0);
  return { incomeCents, refundCents, costCents, costs, balanceCents: incomeCents - refundCents - costCents };
}

export async function partyStatsList() {
  const now = new Date();
  const parties = await prisma.party.findMany({ where: { status: { not: "draft" } }, orderBy: { startsAt: "desc" } });
  const groups = await prisma.guest.groupBy({ by: ["partyId", "status", "type", "gender"], _count: { _all: true } });
  return parties.map((p) => {
    const g = groups.filter((x) => x.partyId === p.id && x.type === "guest");
    const sum = (f: (x: (typeof g)[number]) => boolean) => g.filter(f).reduce((s, x) => s + x._count._all, 0);
    const attended = sum((x) => ATTENDED.includes(x.status));
    const paidNotIn = sum((x) => x.status === "paid");
    const over = p.endsAt < now;
    const noShows = over ? paidNotIn : 0;
    const confirmed = attended + noShows;
    return {
      id: p.id,
      name: p.name,
      startsAt: p.startsAt,
      over,
      attended,
      noShows,
      noShowRate: over && confirmed ? noShows / confirmed : null,
      genders: {
        m: sum((x) => ATTENDED.includes(x.status) && x.gender === "m"),
        w: sum((x) => ATTENDED.includes(x.status) && x.gender === "w"),
        d: sum((x) => ATTENDED.includes(x.status) && x.gender === "d"),
        unknown: sum((x) => ATTENDED.includes(x.status) && !x.gender),
      },
    };
  });
}

/** Einlader-Netzwerk: wer bringt wie viele Gäste, wie zuverlässig. */
export async function inviterStats() {
  const now = new Date();
  const links = await prisma.partyLink.findMany({
    where: { type: { in: ["inviter", "public"] } },
    include: { bookings: { where: { confirmedAt: { not: null } }, include: { guests: { select: { status: true, type: true } }, party: { select: { endsAt: true } } } } },
  });
  const byLabel = new Map<string, { label: string; bookings: number; guests: number; attended: number; noShows: number; parties: Set<string> }>();
  for (const l of links) {
    const label = l.type === "inviter" ? (l.inviterLabel ?? "?") : "Party-Link (öffentlich)";
    const e = byLabel.get(label) ?? { label, bookings: 0, guests: 0, attended: 0, noShows: 0, parties: new Set<string>() };
    for (const b of l.bookings) {
      e.bookings++;
      e.parties.add(l.partyId);
      for (const g of b.guests) {
        if (g.type !== "guest") continue;
        if (["approved_unpaid", "payment_mismatch", "paid", "checked_in", "checked_out"].includes(g.status)) e.guests++;
        if (ATTENDED.includes(g.status)) e.attended++;
        if (g.status === "paid" && b.party.endsAt < now) e.noShows++;
      }
    }
    byLabel.set(label, e);
  }
  return [...byLabel.values()]
    .map((e) => ({ ...e, parties: e.parties.size, noShowRate: e.attended + e.noShows ? e.noShows / (e.attended + e.noShows) : null }))
    .sort((a, b) => b.guests - a.guests);
}

/** Historie je Konto (für Gästeübersicht). */
export async function accountHistory(accountIds: string[]) {
  const now = new Date();
  const bookings = await prisma.booking.findMany({
    where: { accountId: { in: accountIds }, confirmedAt: { not: null } },
    include: { guests: { select: { status: true } }, party: { select: { endsAt: true } }, viaLink: { select: { type: true, inviterLabel: true } } },
    orderBy: { createdAt: "asc" },
  });
  const out: Record<string, { bookings: number; attended: number; noShows: number; firstVia: string | null }> = {};
  for (const b of bookings) {
    const e = (out[b.accountId!] ??= { bookings: 0, attended: 0, noShows: 0, firstVia: null });
    e.bookings++;
    if (b.guests.some((g) => ATTENDED.includes(g.status))) e.attended++;
    if (b.party.endsAt < now && b.guests.some((g) => g.status === "paid")) e.noShows++;
    e.firstVia ??= b.viaLink?.type === "inviter" ? b.viaLink.inviterLabel : b.viaLink ? "Party-Link" : null;
  }
  return out;
}

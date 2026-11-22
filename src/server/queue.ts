/**
 * Daten für die Freigabe-Queue: offene Anfragen, Warteliste, Warnungen, Historie.
 */
import type { GuestStatus as DbGuestStatus } from "@prisma/client";
import { findMatches } from "@/domain/people";
import { prisma } from "./db";
import { ACTIVE_GUEST_STATUSES } from "./bookings";

export interface QueueWarning {
  kind: "duplicate" | "blocklist";
  text: string;
}

export interface QueueGuest {
  id: string;
  name: string;
  email: string | null;
  isBooker: boolean;
  status: DbGuestStatus;
  warnings: QueueWarning[];
}

export interface QueueBooking {
  id: string;
  email: string;
  bookerName: string;
  bookerAttends: boolean;
  referenceCode: string;
  confirmedAt: Date;
  via: string;
  history: { parties: number; attended: number; noShows: number };
  trusted: boolean;
  guests: QueueGuest[];
  bookingWarnings: QueueWarning[];
}

export async function loadQueue(partyId: string, statuses: DbGuestStatus[]): Promise<QueueBooking[]> {
  const bookings = await prisma.booking.findMany({
    where: { partyId, confirmedAt: { not: null }, guests: { some: { status: { in: statuses } } } },
    include: {
      viaLink: true,
      account: true,
      guests: { orderBy: [{ isBooker: "desc" }, { createdAt: "asc" }] },
    },
    orderBy: { confirmedAt: "asc" },
  });
  if (bookings.length === 0) return [];

  // Alle aktiven Personen dieser Party (für Duplikate)
  const others = await prisma.guest.findMany({
    where: { partyId, type: "guest", status: { in: ACTIVE_GUEST_STATUSES } },
    select: { id: true, name: true, email: true, bookingId: true, booking: { select: { referenceCode: true, email: true } } },
  });
  const blocklist = await prisma.blocklist.findMany();
  const blockRefs = blocklist.map((b) => ({ name: b.name ?? "", email: b.email, reason: b.reason }));

  const accountIds = bookings.map((b) => b.accountId).filter((x): x is string => !!x);
  const now = new Date();
  const past = await prisma.booking.findMany({
    where: { accountId: { in: accountIds }, party: { endsAt: { lt: now } }, confirmedAt: { not: null } },
    select: { accountId: true, guests: { select: { status: true } } },
  });

  return bookings.map((b) => {
    const mine = past.filter((p) => p.accountId === b.accountId);
    const history = {
      parties: mine.length,
      attended: mine.filter((p) => p.guests.some((g) => g.status === "checked_in" || g.status === "checked_out")).length,
      noShows: mine.filter((p) => p.guests.some((g) => g.status === "paid")).length,
    };
    const foreign = others.filter((o) => o.bookingId !== b.id);
    const guests: QueueGuest[] = b.guests
      .filter((g) => statuses.includes(g.status))
      .map((g) => {
        const warnings: QueueWarning[] = [];
        for (const hit of findMatches([{ name: g.name, email: g.email }], foreign)) {
          warnings.push({
            kind: "duplicate",
            text: `doppelt (${hit.by === "email" ? "E-Mail" : "Name"}) in Buchung ${hit.match.booking?.referenceCode ?? "?"}`,
          });
        }
        for (const hit of findMatches([{ name: g.name, email: g.email }], blockRefs)) {
          warnings.push({ kind: "blocklist", text: `Sperrliste (${hit.by === "email" ? "E-Mail" : "Name"})${hit.match.reason ? `: ${hit.match.reason}` : ""}` });
        }
        return { id: g.id, name: g.name, email: g.email, isBooker: g.isBooker, status: g.status, warnings };
      });

    const bookingWarnings: QueueWarning[] = [];
    if (!b.bookerAttends) {
      for (const hit of findMatches([{ name: b.bookerName, email: b.email }], blockRefs)) {
        bookingWarnings.push({ kind: "blocklist", text: `Bucher auf Sperrliste (${hit.by === "email" ? "E-Mail" : "Name"})` });
      }
    }
    const fromOtherBooking = foreign.find((o) => o.booking?.email === b.email);
    if (fromOtherBooking) bookingWarnings.push({ kind: "duplicate", text: `E-Mail hat weitere Buchung ${fromOtherBooking.booking?.referenceCode}` });

    return {
      id: b.id,
      email: b.email,
      bookerName: b.bookerName,
      bookerAttends: b.bookerAttends,
      referenceCode: b.referenceCode,
      confirmedAt: b.confirmedAt!,
      via: b.viaLink?.type === "inviter" ? (b.viaLink.inviterLabel ?? "Einlader") : "Party-Link",
      history,
      trusted: b.account?.trusted ?? false,
      guests,
      bookingWarnings,
    };
  });
}

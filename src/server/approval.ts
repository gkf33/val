/**
 * Freigabe-Aktionen des Admins: freigeben, ablehnen, auf Warteliste setzen.
 * Alles läuft unter Party-Lock, die Kapazität wird nie überschritten.
 */
import type { GuestStatus as DbGuestStatus } from "@prisma/client";
import { canMoveUpFromWaitlist, computePaymentDeadline } from "@/domain/deadlines";
import { OCCUPYING_STATUSES } from "@/domain/guestStatus";
import { prisma, type Tx } from "./db";
import { config } from "./config";
import { audit, type Actor } from "./audit";
import { transitionGuests, withPartyLock } from "./capacity";
import { getMailer } from "./mail/mailer";
import { approvedMail, rejectedMail, waitlistMail } from "./mail/templates";
import { paypalMeUrl } from "./payments/paypal";
import { statusUrl } from "./bookings";

export class ApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApprovalError";
  }
}

async function loadGuests(tx: Tx, partyId: string, guestIds: string[]) {
  const guests = await tx.guest.findMany({
    where: { id: { in: guestIds }, partyId, type: "guest" },
    include: { booking: true },
  });
  if (guests.length !== guestIds.length) throw new ApprovalError("Unbekannte Gäste");
  return guests;
}

function byBooking<T extends { bookingId: string | null }>(guests: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const g of guests) {
    if (!g.bookingId) continue;
    m.set(g.bookingId, [...(m.get(g.bookingId) ?? []), g]);
  }
  return m;
}

/**
 * Eindeutiger Cent-Betrag (Feature-Flag UNIQUE_CENT_AMOUNTS): Grundbetrag + 0,01–0,99 €,
 * eindeutig unter allen Buchungen mit offener Zahlung.
 */
export async function uniqueAmount(tx: Tx, baseCents: number, bookingId: string): Promise<number> {
  const taken = new Set(
    (
      await tx.booking.findMany({
        where: {
          id: { not: bookingId },
          lockedAmountCents: { gt: baseCents, lt: baseCents + 100 },
          guests: { some: { status: { in: ["approved_unpaid", "payment_mismatch"] } } },
        },
        select: { lockedAmountCents: true },
      })
    ).map((b) => b.lockedAmountCents),
  );
  for (let c = 1; c <= 99; c++) if (!taken.has(baseCents + c)) return baseCents + c;
  throw new ApprovalError("Keine eindeutigen Cent-Beträge mehr frei");
}

/** Gibt Gäste frei, setzt Betrag und Zahlungsfrist je Buchung, verschickt Mails. */
export async function approveGuests(actor: Actor, partyId: string, guestIds: string[]) {
  if (guestIds.length === 0) return [];
  const now = new Date();
  const bookingIds = await withPartyLock(partyId, async (tx) => {
    const party = await tx.party.findUniqueOrThrow({ where: { id: partyId } });
    const guests = await loadGuests(tx, partyId, guestIds);
    if (guests.some((g) => g.status === "waitlisted") && !canMoveUpFromWaitlist(party, now, config.rules.waitlistCutoffHours)) {
      throw new ApprovalError(`Nachrücken nur bis ${config.rules.waitlistCutoffHours} h vor Beginn`);
    }
    if (guests.some((g) => !g.booking?.confirmedAt)) throw new ApprovalError("E-Mail noch nicht bestätigt");
    const deadline = computePaymentDeadline(now, party, config.rules.paymentCutoffHours);
    if (!deadline) throw new ApprovalError("Zahlungen werden für diese Party nicht mehr akzeptiert");

    await transitionGuests(tx, partyId, guestIds, "approved_unpaid");

    const ids = [...byBooking(guests).keys()];
    for (const bookingId of ids) {
      const approvedCount = await tx.guest.count({
        where: { bookingId, type: "guest", status: { in: OCCUPYING_STATUSES as DbGuestStatus[] } },
      });
      const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId } });
      const base = approvedCount * party.feeCents;
      await tx.booking.update({
        where: { id: bookingId },
        data: {
          approvedAt: booking.approvedAt ?? now,
          lockedAmountCents: config.flags.uniqueCentAmounts ? await uniqueAmount(tx, base, bookingId) : base,
          paymentDeadline: deadline,
          reminderSentAt: null,
        },
      });
    }
    return ids;
  });

  for (const bookingId of bookingIds) {
    const b = await prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { party: true, guests: { where: { status: "approved_unpaid" } } },
    });
    await getMailer().send(
      approvedMail(b.email, {
        statusUrl: statusUrl(),
        party: b.party,
        guests: b.guests.map((g) => g.name),
        amountCents: b.lockedAmountCents ?? 0,
        deadline: b.paymentDeadline!,
        referenceCode: b.referenceCode,
        paypalUrl: paypalMeUrl(b.lockedAmountCents ?? 0),
      }),
    );
  }
  await audit(actor, "guests.approve", { partyId, data: { guestIds, bookings: bookingIds } });
  return bookingIds;
}

export async function rejectGuests(actor: Actor, partyId: string, guestIds: string[], message?: string) {
  if (guestIds.length === 0) return;
  const groups = await withPartyLock(partyId, async (tx) => {
    const guests = await loadGuests(tx, partyId, guestIds);
    await transitionGuests(tx, partyId, guestIds, "rejected");
    return byBooking(guests);
  });
  for (const [, guests] of groups) {
    const b = guests[0].booking!;
    await getMailer().send(rejectedMail(b.email, guests.map((g) => g.name), message?.trim() || undefined));
  }
  await audit(actor, "guests.reject", { partyId, data: { guestIds, message: message ?? null } });
}

export async function waitlistGuests(actor: Actor, partyId: string, guestIds: string[]) {
  if (guestIds.length === 0) return;
  const groups = await withPartyLock(partyId, async (tx) => {
    const guests = await loadGuests(tx, partyId, guestIds);
    await transitionGuests(tx, partyId, guestIds, "waitlisted");
    return byBooking(guests);
  });
  for (const [, guests] of groups) {
    const b = guests[0].booking!;
    const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
    await getMailer().send(waitlistMail(b.email, statusUrl(), party, guests.map((g) => g.name)));
  }
  await audit(actor, "guests.waitlist", { partyId, data: { guestIds } });
}

// ── Crew ──────────────────────────────────────────────────

export async function addCrew(actor: Actor, partyId: string, input: { name: string; role?: string; email?: string }) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new ApprovalError("Name fehlt");
  const guest = await withPartyLock(partyId, async (tx) => {
    const { capacitySnapshot } = await import("./capacity");
    const snap = await capacitySnapshot(tx, partyId);
    if (snap.free < 1) throw new ApprovalError("Keine Plätze frei");
    return tx.guest.create({
      data: {
        partyId,
        name,
        role: input.role?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        type: "crew",
        status: "paid",
        adultConfirmed: true,
      },
    });
  });
  await audit(actor, "crew.add", { partyId, entityType: "Guest", entityId: guest.id, data: { name, role: guest.role } });
  return guest;
}

export async function removeCrew(actor: Actor, partyId: string, guestId: string) {
  await withPartyLock(partyId, async (tx) => {
    const g = await tx.guest.findFirst({ where: { id: guestId, partyId, type: "crew" } });
    if (!g) throw new ApprovalError("Crew-Eintrag nicht gefunden");
    await transitionGuests(tx, partyId, [guestId], "cancelled");
  });
  await audit(actor, "crew.remove", { partyId, entityType: "Guest", entityId: guestId });
}

/**
 * Storno durch Gast (bis SELF_CANCEL_HOURS vor Beginn) oder Admin (jederzeit).
 * Bezahlte Plätze landen auf „Erstattung nötig“, freie Plätze werden gemeldet.
 */
import type { GuestStatus as DbGuestStatus } from "@prisma/client";
import { canSelfCancel } from "@/domain/deadlines";
import { OCCUPYING_STATUSES } from "@/domain/guestStatus";
import { prisma, type Tx } from "./db";
import { config } from "./config";
import { audit, type Actor } from "./audit";
import { transitionGuests, withPartyLock } from "./capacity";
import { getMailer } from "./mail/mailer";
import { cancelConfirmMail, cancelRequestAdminMail } from "./mail/templates";
import { notifyAdminsIfWaitlist } from "./expiry";

export class CancelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CancelError";
  }
}

const CANCELLABLE: DbGuestStatus[] = ["pending_email", "requested", "waitlisted", "approved_unpaid", "payment_mismatch", "paid"];

/** Betrag neu festschreiben und Überzahlung als Erstattung anlegen. */
async function settleBooking(tx: Tx, bookingId: string): Promise<number> {
  const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { party: true } });
  const remaining = await tx.guest.count({ where: { bookingId, type: "guest", status: { in: OCCUPYING_STATUSES as DbGuestStatus[] } } });
  const newLocked = remaining * b.party.feeCents;
  if (b.lockedAmountCents !== null) await tx.booking.update({ where: { id: bookingId }, data: { lockedAmountCents: newLocked } });
  const paid = (await tx.payment.aggregate({ where: { matchedBookingId: bookingId, state: "matched" }, _sum: { grossCents: true } }))._sum.grossCents ?? 0;
  const refunded = (await tx.refund.aggregate({ where: { bookingId, paymentId: null }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  const due = paid - newLocked - refunded;
  if (due > 0) {
    await tx.refund.create({ data: { bookingId, amountCents: due, recipient: b.bookerName, reason: "Storno" } });
  }
  return Math.max(0, due);
}

export async function cancelGuests(actor: Actor, bookingId: string, guestIds: string[] | "all", opts: { asGuestAccountId?: string } = {}) {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { party: true, guests: true } });
  if (opts.asGuestAccountId) {
    if (booking.accountId !== opts.asGuestAccountId) throw new CancelError("Nicht deine Buchung");
    if (!canSelfCancel(booking.party, new Date(), config.rules.selfCancelHours)) {
      throw new CancelError(`Storno nur bis ${config.rules.selfCancelHours} h vor Beginn. Danach bitte anfragen.`);
    }
  }
  const targets = booking.guests.filter((g) => CANCELLABLE.includes(g.status) && (guestIds === "all" || guestIds.includes(g.id)));
  if (targets.length === 0) throw new CancelError("Nichts zu stornieren");

  const refundCents = await withPartyLock(booking.partyId, async (tx) => {
    await transitionGuests(tx, booking.partyId, targets.map((g) => g.id), "cancelled");
    return settleBooking(tx, bookingId);
  });

  await getMailer().send(cancelConfirmMail(booking.email, targets.map((g) => g.name), refundCents));
  await audit(actor, "booking.cancel", { entityType: "Booking", entityId: bookingId, partyId: booking.partyId, data: { guests: targets.length, refundCents } });
  await notifyAdminsIfWaitlist(booking.partyId);
  return { cancelled: targets.length, refundCents };
}

/** Nach Ablauf der Storno-Frist: Anfrage an die Admins. */
export async function requestCancellation(accountId: string, bookingId: string, message: string) {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { party: true } });
  if (b.accountId !== accountId) throw new CancelError("Nicht deine Buchung");
  const url = `${config.appUrl}/admin/parties/${b.partyId}/guests`;
  for (const admin of config.adminEmails) {
    await getMailer().send(cancelRequestAdminMail(admin, url, b.party.name, b.bookerName, b.referenceCode, message.slice(0, 1000)));
  }
  await audit({ type: "guest", label: b.email }, "booking.cancel_request", { entityType: "Booking", entityId: b.id, partyId: b.partyId });
}

/**
 * Zahlungsfristen: abgelaufene Freigaben verfallen lassen, Erinnerungen senden.
 * Wird bei Seitenaufrufen (lazy) und per Cron-Endpoint ausgelöst.
 */
import { reminderDueAt } from "@/domain/deadlines";
import { prisma } from "./db";
import { config } from "./config";
import { audit, SYSTEM } from "./audit";
import { capacitySnapshot, transitionGuests, withPartyLock } from "./capacity";
import { getMailer } from "./mail/mailer";
import { expiredMail, paymentReminderMail, seatFreedAdminMail } from "./mail/templates";
import { statusUrl } from "./bookings";
import { canMoveUpFromWaitlist } from "@/domain/deadlines";

export async function expireOverdue(now = new Date(), partyId?: string): Promise<number> {
  const bookings = await prisma.booking.findMany({
    where: {
      partyId,
      paymentDeadline: { lt: now },
      guests: { some: { status: "approved_unpaid" } },
    },
    select: { id: true, partyId: true },
  });
  let expired = 0;
  const touchedParties = new Set<string>();
  for (const { id, partyId: pid } of bookings) {
    const names = await withPartyLock(pid, async (tx) => {
      // Nach dem Lock erneut prüfen (Zahlung kann inzwischen eingegangen sein)
      const b = await tx.booking.findUnique({ where: { id }, include: { guests: { where: { status: "approved_unpaid" } } } });
      if (!b || !b.paymentDeadline || b.paymentDeadline >= now || b.guests.length === 0) return null;
      await transitionGuests(tx, pid, b.guests.map((g) => g.id), "expired");
      return { email: b.email, names: b.guests.map((g) => g.name) };
    });
    if (!names) continue;
    expired += names.names.length;
    touchedParties.add(pid);
    await getMailer().send(expiredMail(names.email, statusUrl(), names.names));
    await audit(SYSTEM, "booking.expire", { entityType: "Booking", entityId: id, partyId: pid, data: { guests: names.names.length } });
  }
  for (const pid of touchedParties) await notifyAdminsIfWaitlist(pid, now);
  return expired;
}

/** Meldet Admins freie Plätze, wenn jemand auf der Warteliste steht. */
export async function notifyAdminsIfWaitlist(partyId: string, now = new Date()) {
  const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
  if (!canMoveUpFromWaitlist(party, now, config.rules.waitlistCutoffHours)) return;
  const waitlisted = await prisma.guest.count({ where: { partyId, status: "waitlisted" } });
  if (waitlisted === 0) return;
  const snap = await capacitySnapshot(prisma, partyId);
  if (snap.free === 0) return;
  const url = `${config.appUrl}/admin/queue?party=${partyId}`;
  for (const admin of config.adminEmails) {
    await getMailer().send(seatFreedAdminMail(admin, url, party.name, snap.free, waitlisted));
  }
}

export async function sendPaymentReminders(now = new Date(), partyId?: string): Promise<number> {
  const bookings = await prisma.booking.findMany({
    where: {
      partyId,
      reminderSentAt: null,
      approvedAt: { not: null },
      paymentDeadline: { gt: now },
      guests: { some: { status: "approved_unpaid" } },
    },
  });
  let sent = 0;
  for (const b of bookings) {
    const due = reminderDueAt(b.approvedAt!, b.paymentDeadline!, config.rules.paymentReminderMinutes);
    if (!due || due > now) continue;
    const claimed = await prisma.booking.updateMany({ where: { id: b.id, reminderSentAt: null }, data: { reminderSentAt: now } });
    if (claimed.count !== 1) continue;
    await getMailer().send(paymentReminderMail(b.email, statusUrl(), b.paymentDeadline!, b.referenceCode));
    sent++;
  }
  return sent;
}

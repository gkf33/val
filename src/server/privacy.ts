/**
 * Datenschutz: Gästedaten DATA_RETENTION_DAYS nach der Party anonymisieren,
 * Roh-Mails löschen, Konto auf Wunsch löschen.
 * Erhalten bleiben: Konten (bis der Gast löscht), aggregierte Zahlen, Sperrliste.
 */
import { prisma } from "./db";
import { config } from "./config";
import { audit, SYSTEM } from "./audit";
import { getMailer } from "./mail/mailer";
import { accountDeletedMail } from "./mail/templates";

const DAY = 86_400_000;

export async function runRetention(now = new Date()) {
  const cutoff = new Date(now.getTime() - config.rules.dataRetentionDays * DAY);
  const parties = await prisma.party.findMany({ where: { endsAt: { lt: cutoff }, anonymizedAt: null }, select: { id: true, name: true } });
  for (const p of parties) {
    await prisma.$transaction(async (tx) => {
      const bookings = await tx.booking.findMany({ where: { partyId: p.id }, select: { id: true } });
      const ids = bookings.map((b) => b.id);
      // Begleitpersonen und Crew: Namen/E-Mails weg; Status + m/w/d bleiben für Statistik
      await tx.guest.updateMany({
        where: { partyId: p.id },
        data: { name: "—", email: null, ticketToken: null, checkedInDevice: null, role: null },
      });
      await tx.nameChangeRequest.deleteMany({ where: { guest: { partyId: p.id } } });
      // Buchungen: Zuordnung zum Konto bleibt (Historie), Kontaktdaten weg
      await tx.booking.updateMany({ where: { partyId: p.id }, data: { email: "", bookerName: "—", adminNote: null } });
      await tx.payment.updateMany({ where: { matchedBookingId: { in: ids } }, data: { senderName: null, senderEmail: null, note: null, adminNote: null } });
      await tx.refund.updateMany({ where: { bookingId: { in: ids }, status: "refunded" }, data: { recipient: "—" } });
      await tx.doorDevice.deleteMany({ where: { partyId: p.id } });
      await tx.auditLog.updateMany({ where: { partyId: p.id }, data: { data: undefined } });
      await tx.party.update({ where: { id: p.id }, data: { anonymizedAt: now, address: null, directions: null } });
    });
    await audit(SYSTEM, "privacy.party_anonymized", { partyId: p.id });
  }
  // Roh-Mails und nicht zugeordnete Zahlungsdaten
  const rawDeleted = await prisma.inboundEmail.updateMany({ where: { receivedAt: { lt: cutoff }, raw: { not: "" } }, data: { raw: "" } });
  await prisma.payment.updateMany({
    where: { createdAt: { lt: cutoff }, state: { in: ["ignored", "refunded"] } },
    data: { senderName: null, senderEmail: null, note: null },
  });
  await prisma.loginToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - DAY) } } });
  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
  return { parties: parties.length, rawMails: rawDeleted.count };
}

export class AccountDeleteError extends Error {}

/** Konto löschen. Nur ohne aktive Anfragen für kommende Partys. */
export async function deleteAccount(accountId: string) {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const active = await prisma.booking.count({
    where: {
      accountId,
      party: { endsAt: { gt: new Date() } },
      guests: { some: { status: { in: ["requested", "waitlisted", "approved_unpaid", "payment_mismatch", "paid", "checked_in", "checked_out"] } } },
    },
  });
  if (active) throw new AccountDeleteError("Erst die Anfragen für kommende Partys stornieren.");
  await prisma.$transaction(async (tx) => {
    const bookings = await tx.booking.findMany({ where: { accountId }, select: { id: true } });
    const ids = bookings.map((b) => b.id);
    await tx.guest.updateMany({ where: { bookingId: { in: ids } }, data: { name: "—", email: null, ticketToken: null } });
    await tx.booking.updateMany({ where: { accountId }, data: { email: "", bookerName: "—", accountId: null } });
    await tx.payment.updateMany({ where: { matchedBookingId: { in: ids } }, data: { senderName: null, senderEmail: null, note: null } });
    await tx.loginToken.deleteMany({ where: { email: account.email } });
    await tx.account.delete({ where: { id: accountId } });
  });
  await getMailer().send(accountDeletedMail(account.email));
  await audit({ type: "guest", label: "gelöschtes Konto" }, "privacy.account_deleted");
}

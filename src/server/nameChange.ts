/**
 * Namensänderung: Gast beantragt Ersatzperson, Admin gibt frei.
 * Altes Ticket wird ungültig (replaced), neues wird ausgestellt und verschickt.
 */
import { isEmail, isFullName, isGender, normalizeEmail } from "@/domain/people";
import { prisma } from "./db";
import { config } from "./config";
import { audit, type Actor } from "./audit";
import { transitionGuests, withPartyLock } from "./capacity";
import { issueTickets, ticketUrl } from "./tickets";
import { getMailer } from "./mail/mailer";
import { nameChangeAdminMail, nameChangeDecisionMail, ticketMail } from "./mail/templates";

export class NameChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NameChangeError";
  }
}

export async function requestNameChange(
  accountId: string,
  guestId: string,
  input: { name: string; email?: string; gender?: string; adult: boolean },
) {
  const guest = await prisma.guest.findUnique({ where: { id: guestId }, include: { booking: true, party: true } });
  if (!guest?.booking || guest.booking.accountId !== accountId) throw new NameChangeError("Nicht deine Buchung");
  if (guest.status !== "paid") throw new NameChangeError("Nur für bezahlte, noch nicht eingecheckte Plätze");
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!isFullName(name)) throw new NameChangeError("Vor- und Nachname, wie im Ausweis");
  if (input.email && !isEmail(input.email)) throw new NameChangeError("E-Mail ungültig");
  if (!isGender(input.gender)) throw new NameChangeError("Bitte m, w oder d wählen");
  if (!input.adult) throw new NameChangeError("Nur ab 18");
  if (guest.party.startsAt < new Date()) throw new NameChangeError("Party hat schon begonnen");
  const open = await prisma.nameChangeRequest.count({ where: { guestId, status: "pending" } });
  if (open) throw new NameChangeError("Es läuft schon eine Anfrage");

  const req = await prisma.nameChangeRequest.create({
    data: {
      guestId,
      partyId: guest.partyId,
      newName: name,
      newEmail: input.email?.trim() ? normalizeEmail(input.email) : null,
      newGender: input.gender,
      adultConfirmed: true,
    },
  });
  const url = `${config.appUrl}/admin/queue?party=${guest.partyId}&tab=names`;
  for (const admin of config.adminEmails) await getMailer().send(nameChangeAdminMail(admin, url, guest.name, name));
  await audit({ type: "guest", label: guest.booking.email }, "namechange.request", { entityType: "NameChangeRequest", entityId: req.id, partyId: guest.partyId });
  return req;
}

export async function decideNameChange(actor: Actor, requestId: string, approve: boolean) {
  const req = await prisma.nameChangeRequest.findUniqueOrThrow({ where: { id: requestId }, include: { guest: { include: { booking: true, party: true } } } });
  if (req.status !== "pending") throw new NameChangeError("Schon entschieden");
  const { guest } = req;
  const booking = guest.booking!;

  if (!approve) {
    await prisma.nameChangeRequest.update({ where: { id: requestId }, data: { status: "rejected", decidedAt: new Date() } });
    await getMailer().send(nameChangeDecisionMail(booking.email, guest.name, req.newName, false));
    await audit(actor, "namechange.reject", { entityType: "NameChangeRequest", entityId: requestId, partyId: guest.partyId });
    return null;
  }

  const fresh = await withPartyLock(guest.partyId, async (tx) => {
    const current = await tx.guest.findUniqueOrThrow({ where: { id: guest.id } });
    if (current.status !== "paid") throw new NameChangeError("Platz ist nicht mehr bezahlt/offen");
    // Neuer Gast übernimmt den Platz: alter Platz wird frei, neuer belegt ihn im selben Lock
    await transitionGuests(tx, guest.partyId, [guest.id], "replaced");
    const created = await tx.guest.create({
      data: {
        partyId: guest.partyId,
        bookingId: booking.id,
        name: req.newName,
        email: req.newEmail,
        gender: req.newGender,
        adultConfirmed: true,
        isBooker: false,
        status: "paid",
      },
    });
    await issueTickets(tx, [created.id]);
    await tx.guest.update({ where: { id: guest.id }, data: { replacedById: created.id } });
    await tx.nameChangeRequest.update({ where: { id: requestId }, data: { status: "approved", decidedAt: new Date() } });
    return tx.guest.findUniqueOrThrow({ where: { id: created.id } });
  });

  const url = ticketUrl(fresh.ticketToken!);
  await getMailer().send(nameChangeDecisionMail(booking.email, guest.name, fresh.name, true, url));
  if (fresh.email && fresh.email !== booking.email) await getMailer().send(ticketMail(fresh.email, guest.party, fresh.name, url));
  await audit(actor, "namechange.approve", { entityType: "Guest", entityId: fresh.id, partyId: guest.partyId, data: { replaced: guest.id } });
  return fresh;
}

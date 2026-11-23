/**
 * Gäste-Flow: Anfrage absenden, per E-Mail bestätigen.
 */
import type { GuestStatus as DbGuestStatus, LoginToken, PartyLink, Party } from "@prisma/client";
import { generateReferenceCode } from "@/domain/codes";
import { isRegistrationOpen } from "@/domain/deadlines";
import { assertTransition, type GuestStatus } from "@/domain/guestStatus";
import { validateRequest, type RequestInput, type RequestErrors } from "@/domain/people";
import { prisma, type Db } from "./db";
import { config } from "./config";
import { audit } from "./audit";
import { capacitySnapshot, withPartyLock } from "./capacity";
import { createMagicToken } from "./auth/magicLink";
import { getMailer } from "./mail/mailer";
import { confirmEmailMail, requestReceivedMail, waitlistMail } from "./mail/templates";

/** Status, mit denen eine Buchung als aktiv gilt (für MAX_BOOKINGS_PER_ACCOUNT). */
export const ACTIVE_GUEST_STATUSES: DbGuestStatus[] = [
  "requested",
  "waitlisted",
  "approved_unpaid",
  "payment_mismatch",
  "paid",
  "checked_in",
  "checked_out",
];

export class BookingError extends Error {
  constructor(public readonly errors: RequestErrors) {
    super(Object.values(errors).join(", "));
    this.name = "BookingError";
  }
}

export async function countActiveBookings(db: Db, partyId: string, email: string, excludeBookingId?: string) {
  return db.booking.count({
    where: {
      partyId,
      email,
      id: excludeBookingId ? { not: excludeBookingId } : undefined,
      confirmedAt: { not: null },
      guests: { some: { status: { in: ACTIVE_GUEST_STATUSES } } },
    },
  });
}

async function uniqueReferenceCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateReferenceCode();
    if (!(await prisma.booking.findUnique({ where: { referenceCode: code } }))) return code;
  }
  throw new Error("Kein freier Referenzcode gefunden");
}

export function statusUrl(): string {
  return `${config.appUrl}/me`;
}

/**
 * Legt eine unbestätigte Anfrage an und schickt die Bestätigungsmail.
 * Eine ältere unbestätigte Anfrage derselben Adresse für dieselbe Party wird ersetzt.
 */
export async function submitBookingRequest(link: PartyLink & { party: Party }, input: RequestInput) {
  const { party } = link;
  if (party.status !== "open" || !isRegistrationOpen(party, new Date())) {
    throw new BookingError({ form: "Anmeldung geschlossen" });
  }
  const maxGroup = party.maxGroupSize;
  const result = validateRequest(input, maxGroup);
  if (!result.ok) throw new BookingError(result.errors);
  const req = result.value;

  if ((await countActiveBookings(prisma, party.id, req.email)) >= config.rules.maxBookingsPerAccount) {
    throw new BookingError({ form: "Für diese Adresse gibt es schon eine Anfrage. Status über „Zurück“-Login." });
  }

  await prisma.booking.deleteMany({ where: { partyId: party.id, email: req.email, confirmedAt: null } });

  const booking = await prisma.booking.create({
    data: {
      partyId: party.id,
      email: req.email,
      bookerName: req.bookerName,
      bookerAttends: req.bookerAttends,
      viaLinkId: link.id,
      referenceCode: await uniqueReferenceCode(),
      guests: {
        create: req.guests.map((g) => ({
          partyId: party.id,
          name: g.name,
          email: g.email,
          isBooker: g.isBooker,
          gender: g.gender,
          adultConfirmed: true,
          status: "pending_email" as const,
        })),
      },
    },
  });

  const token = await createMagicToken({
    email: req.email,
    purpose: "confirm_booking",
    bookingId: booking.id,
    redirect: "/me",
    ttlMinutes: 24 * 60,
  });
  const url = `${config.appUrl}/auth/verify?token=${encodeURIComponent(token)}`;
  await getMailer().send(confirmEmailMail(req.email, url, party, req.guests.map((g) => g.name)));
  return booking;
}

/**
 * Bestätigt eine Anfrage nach Klick auf den Mail-Link: Konto anlegen bzw.
 * wiedererkennen, Gäste auf „angefragt“ oder (wenn voll) „Warteliste“.
 */
export async function confirmBooking(token: LoginToken) {
  if (!token.bookingId) throw new Error("Token ohne Buchung");
  const booking = await prisma.booking.findUnique({ where: { id: token.bookingId }, include: { party: true } });
  if (!booking) return null;

  const account = await prisma.account.upsert({
    where: { email: booking.email },
    update: {},
    create: { email: booking.email, name: booking.bookerName },
  });
  if (!account.name) await prisma.account.update({ where: { id: account.id }, data: { name: booking.bookerName } });
  if (booking.confirmedAt) return { account, booking, outcome: "already" as const };

  const outcome = await withPartyLock(booking.partyId, async (tx) => {
    const guests = await tx.guest.findMany({ where: { bookingId: booking.id, status: "pending_email" } });
    if ((await countActiveBookings(tx, booking.partyId, booking.email, booking.id)) >= config.rules.maxBookingsPerAccount) {
      await tx.guest.updateMany({ where: { bookingId: booking.id }, data: { status: "cancelled" } });
      return "duplicate" as const;
    }
    const snap = await capacitySnapshot(tx, booking.partyId);
    const to: GuestStatus = snap.free >= guests.length ? "requested" : "waitlisted";
    for (const g of guests) assertTransition(g.status as GuestStatus, to);
    await tx.guest.updateMany({
      where: { id: { in: guests.map((g) => g.id) } },
      data: { status: to, statusChangedAt: new Date() },
    });
    await tx.booking.update({ where: { id: booking.id }, data: { accountId: account.id, confirmedAt: new Date() } });
    return to;
  });

  const guestNames = (await prisma.guest.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: "asc" } })).map((g) => g.name);
  if (outcome === "requested") {
    await getMailer().send(requestReceivedMail(booking.email, statusUrl(), booking.party, guestNames, booking.party.feeCents));
  } else if (outcome === "waitlisted") {
    await getMailer().send(waitlistMail(booking.email, statusUrl(), booking.party, guestNames));
  }
  await audit({ type: "guest", label: booking.email }, `booking.confirm.${outcome}`, {
    entityType: "Booking",
    entityId: booking.id,
    partyId: booking.partyId,
    data: { guests: guestNames.length },
  });
  return { account, booking, outcome };
}

/** Geschlecht des Buchers aus früheren Buchungen (für Vorausfüllen). */
export async function previousBookerGender(accountId: string): Promise<string | null> {
  const g = await prisma.guest.findFirst({
    where: { booking: { accountId }, isBooker: true, gender: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { gender: true },
  });
  return g?.gender ?? null;
}

/** Frühere Begleitpersonen eines Kontos (für Vorausfüllen). */
export async function previousCompanions(accountId: string): Promise<{ name: string; email: string | null; gender: string | null }[]> {
  const guests = await prisma.guest.findMany({
    where: { booking: { accountId }, isBooker: false, type: "guest" },
    orderBy: { createdAt: "desc" },
    select: { name: true, email: true, gender: true },
    take: 50,
  });
  const seen = new Set<string>();
  return guests.filter((g) => (seen.has(g.name) ? false : (seen.add(g.name), true))).slice(0, 8);
}

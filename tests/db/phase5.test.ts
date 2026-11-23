import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { MemoryMailer, setMailer } from "@/server/mail/mailer";
import { approveGuests } from "@/server/approval";
import { cancelGuests, CancelError, requestCancellation } from "@/server/cancellation";
import { decideNameChange, requestNameChange, NameChangeError } from "@/server/nameChange";
import { markBookingPaidManually } from "@/server/payments/apply";
import { capacitySnapshot } from "@/server/capacity";
import { verifyTicketPayload, signTicket } from "@/server/tickets";
import { runRetention, deleteAccount, AccountDeleteError } from "@/server/privacy";
import { partyFinance, inviterStats, partyStatsList } from "@/server/reports";
import { submitBookingRequest } from "@/server/bookings";
import { redeemToken } from "@/server/auth/redeem";
import { generateReferenceCode } from "@/domain/codes";
import { makeParty } from "./helpers";

const mailer = new MemoryMailer();
const admin = { type: "admin" as const, label: "admin" };
beforeAll(() => {
  setMailer(mailer);
  process.env.ADMIN_EMAILS = "admin@test.de";
});
beforeEach(() => {
  mailer.sent = [];
});
afterAll(() => prisma.$disconnect());

async function paidBooking(n = 2, capacity = 10) {
  const party = await makeParty(capacity);
  const account = await prisma.account.create({ data: { email: `acc${Math.random().toString(36).slice(2)}@example.com`, name: "Erika Beispiel" } });
  const booking = await prisma.booking.create({
    data: {
      partyId: party.id,
      accountId: account.id,
      email: account.email,
      bookerName: "Erika Beispiel",
      referenceCode: generateReferenceCode(),
      confirmedAt: new Date(),
      guests: {
        create: Array.from({ length: n }, (_, i) => ({ partyId: party.id, name: `Gast Nr${i}`, isBooker: i === 0, gender: "w" as const, status: "requested" as const })),
      },
    },
    include: { guests: true },
  });
  await approveGuests(admin, party.id, booking.guests.map((g) => g.id));
  await markBookingPaidManually(admin, booking.id, "bar");
  const guests = await prisma.guest.findMany({ where: { bookingId: booking.id }, orderBy: { createdAt: "asc" } });
  return { party, account, booking, guests };
}

describe("Storno", () => {
  it("Gast storniert eine Begleitung → Platz frei, Erstattung anteilig", async () => {
    const { party, account, booking, guests } = await paidBooking(3);
    const r = await cancelGuests(admin, booking.id, [guests[2].id], { asGuestAccountId: account.id });
    expect(r).toEqual({ cancelled: 1, refundCents: 2000 });
    expect((await capacitySnapshot(prisma, party.id)).occupied).toBe(2);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).lockedAmountCents).toBe(4000);
    const refund = await prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(refund).toMatchObject({ amountCents: 2000, reason: "Storno", status: "due" });
    expect(mailer.sent.map((m) => m.subject)).toContain("Storniert");
    // Ticket ungültig
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guests[2].id } })).status).toBe("cancelled");
  });

  it("nach der Frist nur per Anfrage, Admin darf immer", async () => {
    const { party, account, booking, guests } = await paidBooking(1);
    await prisma.party.update({ where: { id: party.id }, data: { startsAt: new Date(Date.now() + 24 * 3_600_000), endsAt: new Date(Date.now() + 30 * 3_600_000) } });
    await expect(cancelGuests(admin, booking.id, "all", { asGuestAccountId: account.id })).rejects.toBeInstanceOf(CancelError);
    await requestCancellation(account.id, booking.id, "krank");
    expect(mailer.sent.at(-1)!.to).toBe("admin@test.de");
    expect((await cancelGuests(admin, booking.id, [guests[0].id])).refundCents).toBe(2000);
  });

  it("fremde Buchung kann nicht storniert werden", async () => {
    const a = await paidBooking(1);
    const b = await paidBooking(1);
    await expect(cancelGuests(admin, a.booking.id, "all", { asGuestAccountId: b.account.id })).rejects.toThrow("Nicht deine Buchung");
  });

  it("unbezahlte Freigabe stornieren → keine Erstattung", async () => {
    const party = await makeParty(10);
    const booking = await prisma.booking.create({
      data: { partyId: party.id, email: "x@example.com", bookerName: "X Y", referenceCode: generateReferenceCode(), confirmedAt: new Date(), guests: { create: [{ partyId: party.id, name: "X Y", status: "requested" }] } },
      include: { guests: true },
    });
    await approveGuests(admin, party.id, [booking.guests[0].id]);
    expect((await cancelGuests(admin, booking.id, "all")).refundCents).toBe(0);
  });
});

describe("Namensänderung", () => {
  it("altes Ticket ungültig, neues gültig, Kapazität unverändert", async () => {
    const { party, account, guests } = await paidBooking(2);
    const before = await capacitySnapshot(prisma, party.id);
    const oldToken = guests[1].ticketToken!;
    const req = await requestNameChange(account.id, guests[1].id, { name: "Neue Person", gender: "m", adult: true, email: "neu@example.com" });
    await expect(requestNameChange(account.id, guests[1].id, { name: "Noch Jemand", gender: "m", adult: true })).rejects.toBeInstanceOf(NameChangeError);
    const fresh = await decideNameChange(admin, req.id, true);
    expect(fresh!.name).toBe("Neue Person");
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guests[1].id } })).status).toBe("replaced");
    expect(verifyTicketPayload(signTicket(fresh!.ticketToken!))).toBe(fresh!.ticketToken);
    expect(fresh!.ticketToken).not.toBe(oldToken);
    expect((await capacitySnapshot(prisma, party.id)).occupied).toBe(before.occupied);
    expect(mailer.sent.map((m) => m.subject)).toEqual(expect.arrayContaining(["Namensänderung bestätigt", "Dein QR-Code"]));
  });

  it("Pflichtangaben und Ablehnung", async () => {
    const { account, guests } = await paidBooking(1);
    await expect(requestNameChange(account.id, guests[0].id, { name: "Ein", gender: "m", adult: true })).rejects.toThrow("Vor- und Nachname");
    await expect(requestNameChange(account.id, guests[0].id, { name: "Neue Person", gender: "x", adult: true })).rejects.toThrow("m, w oder d");
    await expect(requestNameChange(account.id, guests[0].id, { name: "Neue Person", gender: "w", adult: false })).rejects.toThrow("18");
    const req = await requestNameChange(account.id, guests[0].id, { name: "Neue Person", gender: "w", adult: true });
    await decideNameChange(admin, req.id, false);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: guests[0].id } })).status).toBe("paid");
  });
});

describe("Vertraute Gäste", () => {
  it("automatische Freigabe nur für vertraute Personen, mit Flag", async () => {
    process.env.TRUSTED_AUTO_APPROVE = "true";
    try {
      const party = await makeParty(10);
      const link = await prisma.partyLink.create({ data: { partyId: party.id, type: "public", code: Math.random().toString(36).slice(2, 10) } });
      const email = `trusted${Date.now()}@example.com`;
      await prisma.account.create({ data: { email, name: "Vera Vertraut", trusted: true } });
      await submitBookingRequest({ ...link, party }, {
        name: "Vera Vertraut",
        email,
        gender: "w",
        adult: true,
        notAttending: false,
        privacy: true,
        companions: [{ name: "Fremd Begleitung", gender: "m", adult: true }],
      });
      const token = new URL(mailer.sent.at(-1)!.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
      await redeemToken(token);
      const guests = await prisma.guest.findMany({ where: { partyId: party.id }, orderBy: { isBooker: "desc" } });
      expect(guests.map((g) => [g.name, g.status])).toEqual([
        ["Vera Vertraut", "approved_unpaid"],
        ["Fremd Begleitung", "requested"],
      ]);
    } finally {
      process.env.TRUSTED_AUTO_APPROVE = "false";
    }
  });
});

describe("Datenschutz", () => {
  it("Löschjob anonymisiert Gästedaten nach Ablauf, Konto bleibt", async () => {
    const { party, account, guests } = await paidBooking(2);
    await prisma.party.update({ where: { id: party.id }, data: { startsAt: new Date(Date.now() - 40 * 86_400_000), endsAt: new Date(Date.now() - 39 * 86_400_000) } });
    await prisma.guest.update({ where: { id: guests[0].id }, data: { status: "checked_in" } });
    await runRetention();
    const after = await prisma.guest.findMany({ where: { partyId: party.id } });
    expect(after.every((g) => g.name === "—" && g.email === null && g.ticketToken === null)).toBe(true);
    expect(after.map((g) => g.gender)).toEqual(["w", "w"]); // Statistik bleibt
    expect((await prisma.party.findUniqueOrThrow({ where: { id: party.id } })).anonymizedAt).not.toBeNull();
    expect(await prisma.account.findUnique({ where: { id: account.id } })).not.toBeNull();
    const stats = (await partyStatsList()).find((p) => p.id === party.id)!;
    expect(stats).toMatchObject({ attended: 1, noShows: 1 });
  });

  it("Konto löschen nur ohne kommende Anfragen", async () => {
    const { account, booking } = await paidBooking(1);
    await expect(deleteAccount(account.id)).rejects.toBeInstanceOf(AccountDeleteError);
    await cancelGuests(admin, booking.id, "all");
    await deleteAccount(account.id);
    expect(await prisma.account.findUnique({ where: { id: account.id } })).toBeNull();
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).email).toBe("");
  });
});

describe("Auswertungen", () => {
  it("Finanzen: Einnahmen − Erstattungen − Kosten", async () => {
    const { party, booking, guests } = await paidBooking(3);
    await prisma.partyCost.create({ data: { partyId: party.id, label: "Getränke", amountCents: 3000 } });
    await cancelGuests(admin, booking.id, [guests[2].id]);
    expect(await partyFinance(party.id)).toMatchObject({ incomeCents: 6000, refundCents: 2000, costCents: 3000, balanceCents: 1000 });
  });

  it("Einlader-Netzwerk zählt Gäste je Einlader", async () => {
    const party = await makeParty(10);
    const link = await prisma.partyLink.create({ data: { partyId: party.id, type: "inviter", inviterLabel: `Jonas-${Date.now()}`, code: Math.random().toString(36).slice(2, 10) } });
    await prisma.booking.create({
      data: {
        partyId: party.id,
        email: "j@example.com",
        bookerName: "J K",
        viaLinkId: link.id,
        referenceCode: generateReferenceCode(),
        confirmedAt: new Date(),
        guests: { create: [{ partyId: party.id, name: "J K", status: "paid" }, { partyId: party.id, name: "L M", status: "checked_in" }] },
      },
    });
    const row = (await inviterStats()).find((i) => i.label === link.inviterLabel)!;
    expect(row).toMatchObject({ bookings: 1, guests: 2, attended: 1, parties: 1 });
  });
});

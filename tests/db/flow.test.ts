import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { MemoryMailer, setMailer } from "@/server/mail/mailer";
import { submitBookingRequest, BookingError } from "@/server/bookings";
import { redeemToken } from "@/server/auth/redeem";
import { approveGuests, rejectGuests, waitlistGuests, addCrew, ApprovalError } from "@/server/approval";
import { expireOverdue, sendPaymentReminders } from "@/server/expiry";
import { capacitySnapshot } from "@/server/capacity";
import { CapacityError } from "@/domain/capacity";
import { makeParty } from "./helpers";

const mailer = new MemoryMailer();
const admin = { type: "admin" as const, label: "admin@test" };

beforeAll(() => {
  process.env.ADMIN_EMAILS = "admin@test.de";
  process.env.PAYPAL_ME_USER = "partykasse";
  setMailer(mailer);
});
beforeEach(() => {
  mailer.sent = [];
});
afterAll(() => prisma.$disconnect());

async function setup(capacity = 10) {
  const party = await makeParty(capacity);
  const link = await prisma.partyLink.create({ data: { partyId: party.id, type: "public", code: Math.random().toString(36).slice(2, 10) } });
  return { party, link: { ...link, party } };
}

let n = 0;
function req(extra: Partial<Parameters<typeof submitBookingRequest>[1]> = {}) {
  n++;
  return {
    name: `Gast Nummer${"abcdefghijklmnopqrstuvwxyz"[n % 26]}${n}`,
    email: `gast${n}-${Date.now()}@example.com`,
    adult: true,
    notAttending: false,
    privacy: true,
    companions: [],
    ...extra,
  };
}

function lastToken(): string {
  const text = mailer.sent.at(-1)!.text;
  return new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
}

async function submitAndConfirm(link: Awaited<ReturnType<typeof setup>>["link"], r = req()) {
  const booking = await submitBookingRequest(link, r);
  const redeemed = await redeemToken(lastToken());
  return { booking, redeemed, email: r.email };
}

describe("Gäste-Flow", () => {
  it("Anfrage zählt erst nach Bestätigung", async () => {
    const { link } = await setup();
    const r = req({ companions: [{ name: "Sam Muster", adult: true }] });
    const booking = await submitBookingRequest(link, r);
    expect(mailer.sent.at(-1)!.subject).toBe("Bestätige deine Anfrage");
    let guests = await prisma.guest.findMany({ where: { bookingId: booking.id } });
    expect(guests.map((g) => g.status)).toEqual(["pending_email", "pending_email"]);

    const res = await redeemToken(lastToken());
    expect(res?.redirect).toBe("/me");
    guests = await prisma.guest.findMany({ where: { bookingId: booking.id } });
    expect(guests.every((g) => g.status === "requested")).toBe(true);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { account: true } });
    expect(b.account?.email).toBe(r.email);
    expect(b.account?.name).toBe(r.name);
    expect(mailer.sent.at(-1)!.subject).toBe("Anfrage eingegangen");
  });

  it("nur eine aktive Buchung pro Konto und Party", async () => {
    const { link } = await setup();
    const r = req();
    await submitAndConfirm(link, r);
    await expect(submitBookingRequest(link, { ...r, name: "Anders Name" })).rejects.toBeInstanceOf(BookingError);
  });

  it("unbestätigte Anfrage wird durch neue ersetzt", async () => {
    const { link } = await setup();
    const r = req();
    const first = await submitBookingRequest(link, r);
    const second = await submitBookingRequest(link, r);
    expect(await prisma.booking.findUnique({ where: { id: first.id } })).toBeNull();
    expect(await prisma.booking.findUnique({ where: { id: second.id } })).not.toBeNull();
  });

  it("volle Party → Warteliste", async () => {
    const { link, party } = await setup(1);
    await addCrew(admin, party.id, { name: "DJ Eins" });
    const { booking } = await submitAndConfirm(link);
    const g = await prisma.guest.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(g.status).toBe("waitlisted");
    expect(mailer.sent.at(-1)!.subject).toBe("Warteliste");
  });

  it("geschlossene Party nimmt keine Anfragen", async () => {
    const { link, party } = await setup();
    await prisma.party.update({ where: { id: party.id }, data: { status: "closed" } });
    await expect(submitBookingRequest({ ...link, party: { ...party, status: "closed" } }, req())).rejects.toBeInstanceOf(BookingError);
  });
});

describe("Freigabe", () => {
  it("setzt Betrag, Frist und schickt Zahlungsinfos", async () => {
    const { link, party } = await setup();
    const { booking } = await submitAndConfirm(link, req({ companions: [{ name: "Sam Muster", adult: true }, { name: "Kim Muster", adult: true }] }));
    const guests = await prisma.guest.findMany({ where: { bookingId: booking.id } });
    const before = Date.now();
    await approveGuests(admin, party.id, guests.slice(0, 2).map((g) => g.id)); // Teilfreigabe 2 von 3
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(b.lockedAmountCents).toBe(2 * party.feeCents);
    const mins = (b.paymentDeadline!.getTime() - before) / 60000;
    expect(mins).toBeGreaterThan(59);
    expect(mins).toBeLessThan(61);
    const m = mailer.sent.at(-1)!;
    expect(m.subject).toBe("Freigegeben");
    expect(m.text).toContain(b.referenceCode);
    expect(m.text).toContain("https://paypal.me/partykasse/40EUR");

    // Rest später freigeben → Betrag steigt
    await approveGuests(admin, party.id, [guests[2].id]);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } })).lockedAmountCents).toBe(3 * party.feeCents);
  });

  it("über Kapazität wird abgelehnt", async () => {
    const { link, party } = await setup(2);
    const { booking } = await submitAndConfirm(link, req({ companions: [{ name: "Sam Muster", adult: true }, { name: "Kim Muster", adult: true }] }));
    const guests = await prisma.guest.findMany({ where: { bookingId: booking.id } });
    expect(guests[0].status).toBe("waitlisted"); // 3 > 2 frei
    await expect(approveGuests(admin, party.id, guests.map((g) => g.id))).rejects.toBeInstanceOf(CapacityError);
    await approveGuests(admin, party.id, guests.slice(0, 2).map((g) => g.id));
    expect((await capacitySnapshot(prisma, party.id)).free).toBe(0);
  });

  it("Ablehnen mit Nachricht, Warteliste", async () => {
    const { link, party } = await setup();
    const a = await submitAndConfirm(link);
    const b = await submitAndConfirm(link);
    const ga = await prisma.guest.findFirstOrThrow({ where: { bookingId: a.booking.id } });
    const gb = await prisma.guest.findFirstOrThrow({ where: { bookingId: b.booking.id } });
    await rejectGuests(admin, party.id, [ga.id], "Diesmal zu voll.");
    expect(mailer.sent.at(-1)!.text).toContain("Diesmal zu voll.");
    await waitlistGuests(admin, party.id, [gb.id]);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: gb.id } })).status).toBe("waitlisted");
  });

  it("Nachrücken nur bis 24 h vor Beginn", async () => {
    const { link, party } = await setup();
    const { booking } = await submitAndConfirm(link);
    const g = await prisma.guest.findFirstOrThrow({ where: { bookingId: booking.id } });
    await waitlistGuests(admin, party.id, [g.id]);
    await prisma.party.update({ where: { id: party.id }, data: { startsAt: new Date(Date.now() + 10 * 3_600_000), endsAt: new Date(Date.now() + 16 * 3_600_000) } });
    await expect(approveGuests(admin, party.id, [g.id])).rejects.toBeInstanceOf(ApprovalError);
  });
});

describe("Fristen", () => {
  it("Erinnerung nach 40 min, Ablauf nach Frist, Admin-Hinweis bei Warteliste", async () => {
    const { link, party } = await setup(1);
    const a = await submitAndConfirm(link);
    const ga = await prisma.guest.findFirstOrThrow({ where: { bookingId: a.booking.id } });
    await approveGuests(admin, party.id, [ga.id]);
    const w = await submitAndConfirm(link); // voll → Warteliste
    expect((await prisma.guest.findFirstOrThrow({ where: { bookingId: w.booking.id } })).status).toBe("waitlisted");

    const b = await prisma.booking.findUniqueOrThrow({ where: { id: a.booking.id } });
    mailer.sent = [];
    expect(await sendPaymentReminders(new Date(b.approvedAt!.getTime() + 30 * 60000), party.id)).toBe(0);
    expect(await sendPaymentReminders(new Date(b.approvedAt!.getTime() + 41 * 60000), party.id)).toBe(1);
    expect(await sendPaymentReminders(new Date(b.approvedAt!.getTime() + 45 * 60000), party.id)).toBe(0); // nur einmal
    expect(mailer.sent[0].subject).toContain("Erinnerung");

    mailer.sent = [];
    expect(await expireOverdue(new Date(b.paymentDeadline!.getTime() - 1000), party.id)).toBe(0);
    expect(await expireOverdue(new Date(b.paymentDeadline!.getTime() + 1000), party.id)).toBe(1);
    expect((await prisma.guest.findUniqueOrThrow({ where: { id: ga.id } })).status).toBe("expired");
    expect((await capacitySnapshot(prisma, party.id)).free).toBe(1);
    expect(mailer.sent.map((m) => m.subject)).toEqual(["Frist abgelaufen", expect.stringContaining("Platz frei")]);
    expect(mailer.sent[1].to).toBe("admin@test.de");
  });
});

describe("Crew", () => {
  it("belegt Plätze und respektiert die Kapazität", async () => {
    const { party } = await setup(2);
    await addCrew(admin, party.id, { name: "DJ Eins", role: "DJ" });
    await addCrew(admin, party.id, { name: "Bar Zwei", role: "Bar" });
    await expect(addCrew(admin, party.id, { name: "Host Drei" })).rejects.toBeInstanceOf(ApprovalError);
    expect((await capacitySnapshot(prisma, party.id)).free).toBe(0);
  });
});

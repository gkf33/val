import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { MemoryMailer, setMailer } from "@/server/mail/mailer";
import { setDkimVerifier } from "@/server/payments/dkim";
import { ingestRawEmail, processInbound } from "@/server/payments/inbound";
import {
  assignPayment,
  markBookingPaidManually,
  markRefunded,
  reactivateLatePayment,
  recordPayment,
  resolveMismatch,
} from "@/server/payments/apply";
import { importPaypalCsv } from "@/server/payments/csvImport";
import { approveGuests, uniqueAmount } from "@/server/approval";
import { expireOverdue } from "@/server/expiry";
import { capacitySnapshot } from "@/server/capacity";
import { generateReferenceCode } from "@/domain/codes";
import { makeParty } from "./helpers";

const mailer = new MemoryMailer();
const admin = { type: "admin" as const, label: "admin@test" };
let dkimOk = true;

beforeAll(() => {
  setMailer(mailer);
  setDkimVerifier(async () => ({ valid: dkimOk, domains: dkimOk ? ["paypal.at"] : [] }));
});
beforeEach(() => {
  mailer.sent = [];
  dkimOk = true;
});
afterAll(() => prisma.$disconnect());

const fixture = (name: string) => readFileSync(path.join(__dirname, "../fixtures/paypal", name), "utf8");

/** Rohmail mit eigenem Message-ID, Transaktionscode, Betrag und Mitteilung. */
function rawWith(opts: { tx: string; amount?: string; note?: string }) {
  let raw = fixture("de-at-received-with-note.eml")
    .replace(/Message-ID: <[^>]+>/, `Message-ID: <${opts.tx}@test>`)
    .replaceAll("9AB12345CD678901E", opts.tx);
  if (opts.amount) raw = raw.replaceAll("40,00", opts.amount);
  if (opts.note !== undefined) raw = raw.replace("7KQ-M4X", opts.note);
  return raw;
}

let txCounter = 0;
const tx = () => `T${String(Date.now()).slice(-8)}${String(++txCounter).padStart(8, "0")}`.slice(0, 17).toUpperCase();

async function approvedBooking(guests = 2, capacity = 10, code = generateReferenceCode()) {
  const party = await makeParty(capacity);
  const booking = await prisma.booking.create({
    data: {
      partyId: party.id,
      email: `p${Math.random().toString(36).slice(2)}@example.com`,
      bookerName: "Erika Beispiel",
      referenceCode: code,
      confirmedAt: new Date(),
      guests: { create: Array.from({ length: guests }, (_, i) => ({ partyId: party.id, name: `Gast Nr${i}`, status: "requested" as const, adultConfirmed: true })) },
    },
    include: { guests: true },
  });
  await approveGuests(admin, party.id, booking.guests.map((g) => g.id));
  return { party, booking: await prisma.booking.findUniqueOrThrow({ where: { id: booking.id }, include: { guests: true } }) };
}

const statuses = async (bookingId: string) => (await prisma.guest.findMany({ where: { bookingId } })).map((g) => g.status);

describe("Zahlungseingang per Mail", () => {
  it("Referenzcode + passender Betrag → bezahlt, Mail an Gast", async () => {
    const { booking } = await approvedBooking(2);
    mailer.sent = [];
    const r = await ingestRawEmail(rawWith({ tx: tx(), note: `danke ${booking.referenceCode.toLowerCase().replace("-", " ")}` }), "test");
    expect(r.status).toBe("payment");
    if (r.status === "payment") expect(r.payment.status).toBe("paid");
    expect(await statuses(booking.id)).toEqual(["paid", "paid"]);
    expect(mailer.sent.at(-1)!.subject).toBe("Zahlung erhalten · QR-Codes");
  });

  it("gleiche Mail zweimal → nur einmal verbucht", async () => {
    const { booking } = await approvedBooking(2);
    const raw = rawWith({ tx: tx(), note: booking.referenceCode });
    await ingestRawEmail(raw, "test");
    expect((await ingestRawEmail(raw, "test")).status).toBe("duplicate_email");
    expect(await prisma.payment.count({ where: { matchedBookingId: booking.id } })).toBe(1);
  });

  it("ohne gültige DKIM-Signatur nur Vorschlag", async () => {
    const { booking } = await approvedBooking(2);
    dkimOk = false;
    const r = await ingestRawEmail(rawWith({ tx: tx(), note: booking.referenceCode }), "test");
    if (r.status === "payment") expect(r.payment.status).toBe("suggested");
    expect(await statuses(booking.id)).toEqual(["approved_unpaid", "approved_unpaid"]);
    // Admin bestätigt per Klick
    const p = await prisma.payment.findFirstOrThrow({ where: { matchedBookingId: booking.id } });
    expect(await assignPayment(admin, p.id)).toBe("paid");
  });

  it("Zahler-Mail (gesendet) wird archiviert, nicht verbucht", async () => {
    const r = await ingestRawEmail(fixture("de-at-sent.eml"), "test");
    expect(r.status).toBe("ignored");
    const e = await prisma.inboundEmail.findUniqueOrThrow({ where: { id: r.inboundEmailId } });
    expect(e.kind).toBe("ignored");
    expect(e.raw.length).toBeGreaterThan(100);
  });

  it("Teilzahlung → Abweichung, Rest nachfordern, zweite Zahlung → bezahlt", async () => {
    const { booking } = await approvedBooking(2);
    await ingestRawEmail(rawWith({ tx: tx(), amount: "20,00", note: booking.referenceCode }), "test");
    expect(await statuses(booking.id)).toEqual(["payment_mismatch", "payment_mismatch"]);
    await resolveMismatch(admin, booking.id, "request_rest");
    expect(mailer.sent.at(-1)!.text).toContain("20,00");
    await ingestRawEmail(rawWith({ tx: tx(), amount: "20,00", note: booking.referenceCode }), "test");
    expect(await statuses(booking.id)).toEqual(["paid", "paid"]);
  });

  it("Überzahlung → Differenz erstatten", async () => {
    const { booking } = await approvedBooking(2);
    await ingestRawEmail(rawWith({ tx: tx(), amount: "50,00", note: booking.referenceCode }), "test");
    await resolveMismatch(admin, booking.id, "refund_difference");
    expect(await statuses(booking.id)).toEqual(["paid", "paid"]);
    const refund = await prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(refund.amountCents).toBe(1000);
    await markRefunded(admin, refund.id);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("refunded");
  });

  it("verspätet nach Ablauf, Platz frei → Reaktivierung per Klick", async () => {
    const { party, booking } = await approvedBooking(2);
    await expireOverdue(new Date(booking.paymentDeadline!.getTime() + 1000), party.id);
    expect(await statuses(booking.id)).toEqual(["expired", "expired"]);
    const r = await ingestRawEmail(rawWith({ tx: tx(), note: booking.referenceCode }), "test");
    if (r.status === "payment") expect(r.payment.status).toBe("late");
    const p = await prisma.payment.findFirstOrThrow({ where: { matchedBookingId: booking.id } });
    expect(await reactivateLatePayment(admin, p.id)).toBe("paid");
    expect(await statuses(booking.id)).toEqual(["paid", "paid"]);
  });

  it("verspätet, kein Platz mehr frei → Erstattung nötig", async () => {
    const { party, booking } = await approvedBooking(2, 2);
    await expireOverdue(new Date(booking.paymentDeadline!.getTime() + 1000), party.id);
    await prisma.guest.createMany({ data: [1, 2].map((i) => ({ partyId: party.id, name: `Crew ${i}`, type: "crew" as const, status: "paid" as const })) });
    expect((await capacitySnapshot(prisma, party.id)).free).toBe(0);
    const r = await ingestRawEmail(rawWith({ tx: tx(), note: booking.referenceCode }), "test");
    if (r.status === "payment") expect(r.payment.status).toBe("refund_due");
    const refund = await prisma.refund.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(refund).toMatchObject({ amountCents: 4000, status: "due", recipient: "Erika Beispiel" });
  });

  it("unbekannte Zahlung → nicht zugeordnet; manuell per Code zuordnen", async () => {
    const { booking } = await approvedBooking(2);
    const r = await ingestRawEmail(rawWith({ tx: tx(), note: "für die party" }), "test");
    if (r.status !== "payment") throw new Error("erwartet Zahlung");
    // Name „Erika Beispiel“ + Betrag passt → Vorschlag
    expect(["suggested", "unmatched"]).toContain(r.payment.status);
    expect(await assignPayment(admin, r.payment.paymentId, booking.referenceCode.toLowerCase())).toBe("paid");
  });

  it("Gebühr abgezogen (Waren & Dienstleistungen) → nie automatisch", async () => {
    const { booking } = await approvedBooking(1);
    const r = await recordPayment({ paypalTxId: tx(), grossCents: 2000, feeCents: 70, note: booking.referenceCode, source: "email", trusted: true });
    expect(r.status).toBe("suggested");
  });

  it("neu parsen einer gespeicherten Mail", async () => {
    const { booking } = await approvedBooking(2);
    dkimOk = true;
    const r = await ingestRawEmail(rawWith({ tx: tx(), note: booking.referenceCode }), "test");
    const again = await processInbound(r.inboundEmailId);
    expect(again.status === "payment" && again.payment.status).toBe("duplicate");
  });
});

describe("Cent-genaue Beträge", () => {
  it("eindeutig je offener Buchung und automatisch zuordenbar", async () => {
    process.env.UNIQUE_CENT_AMOUNTS = "true";
    try {
      const a = await approvedBooking(2);
      const b = await approvedBooking(2);
      expect(a.booking.lockedAmountCents).not.toBe(b.booking.lockedAmountCents);
      expect(a.booking.lockedAmountCents! % 100).toBeGreaterThan(0);
      const amount = (a.booking.lockedAmountCents! / 100).toFixed(2).replace(".", ",");
      const r = await ingestRawEmail(rawWith({ tx: tx(), amount, note: "" }), "test");
      if (r.status === "payment") expect(r.payment.status).toBe("paid");
      expect(await statuses(a.booking.id)).toEqual(["paid", "paid"]);
      await prisma.$transaction((t) => uniqueAmount(t, 4000, "x")); // läuft ohne Fehler
    } finally {
      process.env.UNIQUE_CENT_AMOUNTS = "false";
    }
  });
});

describe("Manuell und CSV", () => {
  it("bar bezahlt markieren", async () => {
    const { booking } = await approvedBooking(2);
    expect(await markBookingPaidManually(admin, booking.id, "bar an der Bar")).toBe("paid");
    const p = await prisma.payment.findFirstOrThrow({ where: { matchedBookingId: booking.id } });
    expect(p).toMatchObject({ source: "manual", grossCents: 4000, adminNote: "bar an der Bar" });
  });

  it("CSV-Import erkennt bereits verbuchte Transaktionen", async () => {
    const { booking } = await approvedBooking(2);
    const id = tx();
    await ingestRawEmail(rawWith({ tx: id, note: booking.referenceCode }), "test");
    const csv = `"Datum","Name","Typ","Status","Währung","Brutto","Gebühr","Transaktionscode","Hinweis"
"01.12.2026","Erika Beispiel","Zahlung erhalten","Abgeschlossen","EUR","40,00","0,00","${id}","${booking.referenceCode}"
"01.12.2026","Fremd Person","Zahlung erhalten","Abgeschlossen","EUR","13,00","0,00","${tx()}",""`;
    const r = await importPaypalCsv(admin, csv);
    expect(r).toMatchObject({ rows: 2, duplicates: 1, paid: 0, other: 1 });
  });
});

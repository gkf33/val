/**
 * Verbuchung von Zahlungen: Zuordnung, Statuswechsel, Sonderfälle.
 * Alle Statuswechsel laufen unter Party-Lock über die Statusmaschine.
 */
import type { PaymentSource, Prisma } from "@prisma/client";
import { matchPayment, type MatchCandidate } from "@/domain/matching";
import { normalizeReferenceCode } from "@/domain/codes";
import { prisma, type Tx } from "../db";
import { config } from "../config";
import { audit, SYSTEM, type Actor } from "../audit";
import { capacitySnapshot, transitionGuests, withPartyLock } from "../capacity";
import { getMailer } from "../mail/mailer";
import { paymentReceivedMail, restRequestMail } from "../mail/templates";
import { statusUrl } from "../bookings";

export interface PaymentInput {
  paypalTxId: string;
  grossCents: number;
  feeCents?: number | null;
  currency?: string;
  senderName?: string | null;
  senderEmail?: string | null;
  note?: string | null;
  paidAt?: Date | null;
  source: PaymentSource;
  inboundEmailId?: string;
  /** false = Herkunft nicht verifiziert (z. B. DKIM ungültig) → nie automatisch verbuchen */
  trusted: boolean;
}

export type RecordOutcome =
  | { status: "duplicate"; paymentId: string }
  | { status: "paid" | "mismatch" | "late" | "refund_due" | "suggested" | "unmatched"; paymentId: string; bookingId?: string };

function toleranceCents(): number {
  return Math.round(Number(process.env.AMOUNT_TOLERANCE_EUR ?? 0) * 100);
}

/** Summe aller verbuchten Zahlungen einer Buchung. */
async function paidTotal(tx: Tx, bookingId: string): Promise<number> {
  const agg = await tx.payment.aggregate({ where: { matchedBookingId: bookingId, state: "matched" }, _sum: { grossCents: true } });
  return agg._sum.grossCents ?? 0;
}

async function candidates(note: string | null): Promise<MatchCandidate[]> {
  // Offene Buchungen (für Betrag/Name) + alle Buchungen, deren Code in der Mitteilung stehen könnte.
  const or: Prisma.BookingWhereInput[] = [{ guests: { some: { status: { in: ["approved_unpaid", "payment_mismatch"] } } } }];
  if (note) {
    const n = normalizeReferenceCode(note);
    const windows = new Set<string>();
    for (let i = 0; i + 6 <= n.length; i++) windows.add(`${n.slice(i, i + 3)}-${n.slice(i + 3, i + 6)}`);
    if (windows.size) or.push({ referenceCode: { in: [...windows] } });
  }
  const bookings = await prisma.booking.findMany({
    where: { confirmedAt: { not: null }, OR: or },
    include: { guests: { select: { name: true, status: true } }, payments: { where: { state: "matched" }, select: { grossCents: true } } },
  });
  return bookings.map((b) => {
    const paid = b.payments.reduce((s, p) => s + p.grossCents, 0);
    return {
      bookingId: b.id,
      referenceCode: b.referenceCode,
      lockedAmountCents: b.lockedAmountCents,
      dueCents: (b.lockedAmountCents ?? 0) - paid,
      open: b.guests.some((g) => g.status === "approved_unpaid" || g.status === "payment_mismatch"),
      names: [b.bookerName, ...b.guests.map((g) => g.name)],
    };
  });
}

/** Legt eine Zahlung an (idempotent über die Transaktions-ID) und ordnet sie zu. */
export async function recordPayment(input: PaymentInput, actor: Actor = SYSTEM): Promise<RecordOutcome> {
  const existing = await prisma.payment.findUnique({ where: { paypalTxId: input.paypalTxId } });
  if (existing) return { status: "duplicate", paymentId: existing.id };

  const payment = await prisma.payment.create({
    data: {
      paypalTxId: input.paypalTxId,
      grossCents: input.grossCents,
      feeCents: input.feeCents ?? null,
      currency: input.currency ?? "EUR",
      senderName: input.senderName ?? null,
      senderEmail: input.senderEmail ?? null,
      note: input.note ?? null,
      paidAt: input.paidAt ?? null,
      source: input.source,
      inboundEmailId: input.inboundEmailId,
      state: "unmatched",
    },
  });

  const match = matchPayment(
    { grossCents: payment.grossCents, currency: payment.currency, note: payment.note, senderName: payment.senderName },
    await candidates(payment.note),
    { toleranceCents: toleranceCents(), uniqueCents: config.flags.uniqueCentAmounts },
  );
  // Gebühr abgezogen (Waren & Dienstleistungen) → nie automatisch
  const feeTaken = (input.feeCents ?? 0) > 0;

  if (!match.bookingId) {
    await audit(actor, "payment.unmatched", { entityType: "Payment", entityId: payment.id, data: { gross: payment.grossCents } });
    return { status: "unmatched", paymentId: payment.id };
  }
  if (!match.auto || !input.trusted || feeTaken) {
    await prisma.payment.update({ where: { id: payment.id }, data: { state: "suggested", matchedBookingId: match.bookingId, matchType: match.type === "none" ? null : match.type } });
    await audit(actor, "payment.suggested", { entityType: "Payment", entityId: payment.id, data: { bookingId: match.bookingId, type: match.type, trusted: input.trusted, feeTaken } });
    return { status: "suggested", paymentId: payment.id, bookingId: match.bookingId };
  }
  const status = await applyPayment(actor, payment.id, match.bookingId, match.type === "none" ? "manual" : match.type);
  return { status, paymentId: payment.id, bookingId: match.bookingId };
}

/**
 * Verbucht eine Zahlung auf eine Buchung und setzt die Gäste-Status.
 * - offene Gäste + Betrag passt → paid
 * - Teil-/Überzahlung → payment_mismatch (Admin entscheidet)
 * - Frist abgelaufen → late (Reaktivierung möglich, wenn Platz frei) oder refund_due
 * - storniert/abgelehnt/Warteliste/schon bezahlt → refund_due
 */
export async function applyPayment(
  actor: Actor,
  paymentId: string,
  bookingId: string,
  matchType: "reference" | "unique_amount" | "name_amount" | "manual",
): Promise<"paid" | "mismatch" | "late" | "refund_due"> {
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const result = await withPartyLock(booking.partyId, async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.state === "matched") throw new Error("Zahlung ist bereits verbucht");
    const guests = await tx.guest.findMany({ where: { bookingId, type: "guest" } });
    const open = guests.filter((g) => g.status === "approved_unpaid" || g.status === "payment_mismatch");

    if (open.length > 0) {
      await tx.payment.update({ where: { id: paymentId }, data: { state: "matched", matchedBookingId: bookingId, matchType } });
      const total = await paidTotal(tx, bookingId);
      const locked = booking.lockedAmountCents ?? 0;
      if (Math.abs(total - locked) <= toleranceCents()) {
        await transitionGuests(tx, booking.partyId, open.map((g) => g.id), "paid");
        return "paid" as const;
      }
      const toMismatch = open.filter((g) => g.status === "approved_unpaid").map((g) => g.id);
      if (toMismatch.length) await transitionGuests(tx, booking.partyId, toMismatch, "payment_mismatch");
      return "mismatch" as const;
    }

    const expired = guests.filter((g) => g.status === "expired");
    if (expired.length > 0) {
      const snap = await capacitySnapshot(tx, booking.partyId);
      if (snap.free >= expired.length) {
        await tx.payment.update({ where: { id: paymentId }, data: { state: "late", matchedBookingId: bookingId, matchType } });
        return "late" as const;
      }
    }
    await tx.payment.update({ where: { id: paymentId }, data: { state: "refund_due", matchedBookingId: bookingId, matchType } });
    await tx.refund.create({
      data: {
        bookingId,
        paymentId,
        amountCents: payment.grossCents,
        recipient: payment.senderName ?? booking.email,
        reason: expired.length ? "Verspätet, kein Platz mehr frei" : "Keine offene Zahlung für diese Buchung",
      },
    });
    return "refund_due" as const;
  });

  if (result === "paid") await sendPaidMail(bookingId);
  await audit(actor, `payment.apply.${result}`, { entityType: "Payment", entityId: paymentId, partyId: booking.partyId, data: { bookingId, matchType } });
  return result;
}

async function sendPaidMail(bookingId: string) {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { party: true, guests: { where: { status: "paid" } } } });
  await getMailer().send(paymentReceivedMail(b.email, statusUrl(), b.party, b.guests.map((g) => g.name)));
}

// ── Admin-Aktionen ────────────────────────────────────────

/** Reaktiviert eine Buchung mit verspäteter Zahlung (nur mit freiem Platz). */
export async function reactivateLatePayment(actor: Actor, paymentId: string) {
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (payment.state !== "late" || !payment.matchedBookingId) throw new Error("Zahlung ist nicht verspätet");
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: payment.matchedBookingId } });
  await withPartyLock(booking.partyId, async (tx) => {
    const expired = await tx.guest.findMany({ where: { bookingId: booking.id, status: "expired" } });
    await transitionGuests(tx, booking.partyId, expired.map((g) => g.id), "approved_unpaid"); // prüft Kapazität
    await tx.payment.update({ where: { id: paymentId }, data: { state: "unmatched" } });
  });
  await audit(actor, "payment.reactivate", { entityType: "Payment", entityId: paymentId, partyId: booking.partyId });
  return applyPayment(actor, paymentId, booking.id, payment.matchType ?? "manual");
}

/** Zahlung auf „Erstattung nötig“ setzen (verspätet, unbekannt, doppelt). */
export async function markPaymentForRefund(actor: Actor, paymentId: string, reason: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  await prisma.$transaction([
    prisma.payment.update({ where: { id: paymentId }, data: { state: "refund_due" } }),
    prisma.refund.create({
      data: { paymentId, bookingId: p.matchedBookingId, amountCents: p.grossCents, recipient: p.senderName ?? p.senderEmail ?? "?", reason },
    }),
  ]);
  await audit(actor, "payment.refund_due", { entityType: "Payment", entityId: paymentId, data: { reason } });
}

export async function ignorePayment(actor: Actor, paymentId: string, note?: string) {
  await prisma.payment.update({ where: { id: paymentId }, data: { state: "ignored", adminNote: note || null, matchedBookingId: null } });
  await audit(actor, "payment.ignore", { entityType: "Payment", entityId: paymentId, data: { note: note ?? null } });
}

/** Ordnet eine Zahlung per Referenzcode manuell zu bzw. bestätigt einen Vorschlag. */
export async function assignPayment(actor: Actor, paymentId: string, referenceCode?: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  let bookingId = p.matchedBookingId;
  if (referenceCode) {
    const n = normalizeReferenceCode(referenceCode);
    const b = await prisma.booking.findUnique({ where: { referenceCode: `${n.slice(0, 3)}-${n.slice(3)}` } });
    if (!b) throw new Error("Referenzcode unbekannt");
    bookingId = b.id;
  }
  if (!bookingId) throw new Error("Keine Buchung gewählt");
  await prisma.payment.update({ where: { id: paymentId }, data: { state: "unmatched" } });
  return applyPayment(actor, paymentId, bookingId, "manual");
}

/** Manuell als bezahlt markieren (z. B. bar), legt eine manuelle Zahlung über den offenen Betrag an. */
export async function markBookingPaidManually(actor: Actor, bookingId: string, note: string) {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const paid = await prisma.payment.aggregate({ where: { matchedBookingId: bookingId, state: "matched" }, _sum: { grossCents: true } });
  const due = (b.lockedAmountCents ?? 0) - (paid._sum.grossCents ?? 0);
  if (due <= 0) throw new Error("Kein offener Betrag");
  const p = await prisma.payment.create({
    data: { paypalTxId: `manual-${b.id}-${Date.now()}`, grossCents: due, source: "manual", state: "unmatched", adminNote: note, senderName: actor.label },
  });
  return applyPayment(actor, p.id, bookingId, "manual");
}

/** Abweichung lösen: akzeptieren, Differenz erstatten oder Rest nachfordern. */
export async function resolveMismatch(actor: Actor, bookingId: string, decision: "accept" | "refund_difference" | "request_rest") {
  const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { party: true } });
  const outcome = await withPartyLock(b.partyId, async (tx) => {
    const mismatched = await tx.guest.findMany({ where: { bookingId, status: "payment_mismatch" } });
    if (mismatched.length === 0) throw new Error("Keine Abweichung offen");
    const total = await paidTotal(tx, bookingId);
    const locked = b.lockedAmountCents ?? 0;
    if (decision === "request_rest") {
      if (total >= locked) throw new Error("Kein Rest offen");
      return { rest: locked - total };
    }
    if (decision === "refund_difference") {
      if (total <= locked) throw new Error("Keine Überzahlung");
      await tx.refund.create({ data: { bookingId, amountCents: total - locked, recipient: b.bookerName, reason: "Überzahlung" } });
    }
    await transitionGuests(tx, b.partyId, mismatched.map((g) => g.id), "paid");
    return { rest: 0 };
  });
  if (decision === "request_rest") {
    await getMailer().send(restRequestMail(b.email, statusUrl(), outcome.rest, b.referenceCode));
  } else {
    await sendPaidMail(bookingId);
  }
  await audit(actor, `payment.mismatch.${decision}`, { entityType: "Booking", entityId: bookingId, partyId: b.partyId });
}

export async function markRefunded(actor: Actor, refundId: string) {
  const r = await prisma.refund.update({ where: { id: refundId }, data: { status: "refunded", refundedAt: new Date() } });
  if (r.paymentId) {
    const p = await prisma.payment.findUnique({ where: { id: r.paymentId } });
    if (p?.state === "refund_due") await prisma.payment.update({ where: { id: r.paymentId }, data: { state: "refunded" } });
  }
  await audit(actor, "refund.done", { entityType: "Refund", entityId: refundId, data: { amount: r.amountCents } });
}

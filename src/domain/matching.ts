/**
 * Zuordnung eingehender Zahlungen zu Buchungen.
 * Reihenfolge: 1. Referenzcode in der Mitteilung, 2. eindeutiger Cent-Betrag,
 * 3. Name + Betrag (nur Vorschlag).
 */
import { REFERENCE_ALPHABET, normalizeReferenceCode } from "./codes";
import { normalizeName } from "./people";

export interface MatchCandidate {
  bookingId: string;
  referenceCode: string;
  /** Noch offener Betrag (festgeschrieben − bereits gezahlt) */
  dueCents: number;
  lockedAmountCents: number | null;
  /** Buchung hat Gäste mit offener Zahlung */
  open: boolean;
  names: string[];
}

export interface MatchResult {
  type: "reference" | "unique_amount" | "name_amount" | "none";
  bookingId: string | null;
  /** true = darf automatisch verbucht werden */
  auto: boolean;
}

/** Alle möglichen Referenzcodes in einem Freitext (tolerant gegenüber Leerzeichen, Bindestrich, Groß-/Klein). */
export function findReferenceCodes(note: string, known: Set<string>): string[] {
  const n = normalizeReferenceCode(note);
  const found = new Set<string>();
  for (let i = 0; i + 6 <= n.length; i++) {
    const w = n.slice(i, i + 6);
    if ([...w].every((c) => REFERENCE_ALPHABET.includes(c)) && known.has(w)) found.add(w);
  }
  return [...found];
}

export function matchPayment(
  payment: { grossCents: number; currency: string; note: string | null; senderName: string | null },
  candidates: MatchCandidate[],
  opts: { toleranceCents: number; uniqueCents: boolean },
): MatchResult {
  const none: MatchResult = { type: "none", bookingId: null, auto: false };
  if (payment.currency !== "EUR") return none;

  if (payment.note) {
    const byCode = new Map(candidates.map((c) => [normalizeReferenceCode(c.referenceCode), c]));
    const codes = findReferenceCodes(payment.note, new Set(byCode.keys()));
    if (codes.length === 1) return { type: "reference", bookingId: byCode.get(codes[0])!.bookingId, auto: true };
  }

  const open = candidates.filter((c) => c.open);
  if (opts.uniqueCents) {
    const exact = open.filter((c) => c.dueCents === payment.grossCents && c.dueCents % 100 !== 0);
    if (exact.length === 1) return { type: "unique_amount", bookingId: exact[0].bookingId, auto: true };
  }

  if (payment.senderName) {
    const sender = normalizeName(payment.senderName);
    const amountOk = (c: MatchCandidate) => Math.abs(c.dueCents - payment.grossCents) <= opts.toleranceCents;
    const hits = open.filter((c) => amountOk(c) && c.names.some((n) => normalizeName(n) === sender));
    if (hits.length === 1) return { type: "name_amount", bookingId: hits[0].bookingId, auto: false };
  }
  return none;
}

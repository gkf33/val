import { describe, expect, it } from "vitest";
import { findReferenceCodes, matchPayment, type MatchCandidate } from "@/domain/matching";

const c = (over: Partial<MatchCandidate>): MatchCandidate => ({
  bookingId: "b",
  referenceCode: "7KQ-M4X",
  dueCents: 4000,
  lockedAmountCents: 4000,
  open: true,
  names: ["Alex Beispiel"],
  ...over,
});
const opts = { toleranceCents: 0, uniqueCents: false };
const pay = (over: Partial<{ grossCents: number; currency: string; note: string | null; senderName: string | null }> = {}) => ({
  grossCents: 4000,
  currency: "EUR",
  note: null,
  senderName: null,
  ...over,
});

describe("Referenzcodes im Text", () => {
  const known = new Set(["7KQM4X", "BZ5HWS"]);
  it("tolerant", () => {
    expect(findReferenceCodes("7kq m4x", known)).toEqual(["7KQM4X"]);
    expect(findReferenceCodes("Danke! Code: 7KQ-M4X :)", known)).toEqual(["7KQM4X"]);
    expect(findReferenceCodes("bz5 hws und 7kqm4x", known).sort()).toEqual(["7KQM4X", "BZ5HWS"]);
    expect(findReferenceCodes("nichts", known)).toEqual([]);
  });
});

describe("Matching", () => {
  it("1. Referenzcode, automatisch", () => {
    const r = matchPayment(pay({ note: "7kq m4x" }), [c({ bookingId: "a" }), c({ bookingId: "z", referenceCode: "BZ5-HWS" })], opts);
    expect(r).toEqual({ type: "reference", bookingId: "a", auto: true });
  });

  it("Referenzcode trifft auch nicht-offene Buchungen (für verspätete Zahlungen)", () => {
    const r = matchPayment(pay({ note: "7KQ-M4X" }), [c({ bookingId: "a", open: false })], opts);
    expect(r.bookingId).toBe("a");
  });

  it("zwei Codes in einer Mitteilung → kein Auto-Treffer", () => {
    const r = matchPayment(pay({ note: "7KQ-M4X BZ5-HWS" }), [c({ bookingId: "a" }), c({ bookingId: "b", referenceCode: "BZ5-HWS" })], opts);
    expect(r.type).not.toBe("reference");
  });

  it("2. eindeutiger Cent-Betrag nur mit Flag", () => {
    const cands = [c({ bookingId: "a", dueCents: 4007 }), c({ bookingId: "b", dueCents: 4012, referenceCode: "BZ5-HWS" })];
    expect(matchPayment(pay({ grossCents: 4007 }), cands, opts).type).toBe("none");
    expect(matchPayment(pay({ grossCents: 4007 }), cands, { ...opts, uniqueCents: true })).toEqual({
      type: "unique_amount",
      bookingId: "a",
      auto: true,
    });
  });

  it("3. Name + Betrag nur als Vorschlag", () => {
    const r = matchPayment(pay({ senderName: "alex  BEISPIEL" }), [c({ bookingId: "a" })], opts);
    expect(r).toEqual({ type: "name_amount", bookingId: "a", auto: false });
  });

  it("Name passt, Betrag nicht → nichts (außer Toleranz)", () => {
    expect(matchPayment(pay({ grossCents: 3950, senderName: "Alex Beispiel" }), [c({})], opts).type).toBe("none");
    expect(matchPayment(pay({ grossCents: 3950, senderName: "Alex Beispiel" }), [c({})], { ...opts, toleranceCents: 50 }).type).toBe("name_amount");
  });

  it("Betrag allein reicht nie", () => {
    expect(matchPayment(pay({ senderName: "Fremd Person" }), [c({})], opts).type).toBe("none");
  });

  it("Fremdwährung → nichts", () => {
    expect(matchPayment(pay({ currency: "USD", note: "7KQ-M4X" }), [c({})], opts).type).toBe("none");
  });
});

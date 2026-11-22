import { describe, expect, it } from "vitest";
import {
  GUEST_STATUSES,
  OCCUPYING_STATUSES,
  TransitionError,
  assertTransition,
  canTransition,
  needsSeat,
  occupiesSeat,
} from "@/domain/guestStatus";

describe("Statusmaschine", () => {
  it("erlaubt den Normalfluss bis zum Check-in", () => {
    const flow = ["pending_email", "requested", "approved_unpaid", "paid", "checked_in", "checked_out", "checked_in"] as const;
    for (let i = 0; i < flow.length - 1; i++) {
      expect(canTransition(flow[i], flow[i + 1])).toBe(true);
    }
  });

  it("erlaubt Warteliste und Rückweg zur Anfrage", () => {
    expect(canTransition("requested", "waitlisted")).toBe(true);
    expect(canTransition("waitlisted", "requested")).toBe(true);
  });

  it("erlaubt Reaktivierung nach abgelaufener Frist", () => {
    expect(canTransition("expired", "approved_unpaid")).toBe(true);
    expect(canTransition("expired", "paid")).toBe(true);
  });

  it("verbietet Check-in ohne Zahlung", () => {
    expect(canTransition("approved_unpaid", "checked_in")).toBe(false);
    expect(canTransition("requested", "checked_in")).toBe(false);
    expect(() => assertTransition("approved_unpaid", "checked_in")).toThrow(TransitionError);
  });

  it("Endzustände haben keine Ausgänge", () => {
    for (const s of ["rejected", "cancelled", "replaced"] as const) {
      for (const t of GUEST_STATUSES) expect(canTransition(s, t)).toBe(false);
    }
  });

  it("paid kann storniert oder ersetzt werden", () => {
    expect(canTransition("paid", "cancelled")).toBe(true);
    expect(canTransition("paid", "replaced")).toBe(true);
    expect(canTransition("checked_in", "cancelled")).toBe(false);
  });

  it("Belegung: nur freigegebene, bezahlte und eingecheckte Gäste", () => {
    expect(OCCUPYING_STATUSES).toEqual(
      expect.arrayContaining(["approved_unpaid", "payment_mismatch", "paid", "checked_in", "checked_out"]),
    );
    for (const s of ["pending_email", "requested", "waitlisted", "rejected", "expired", "cancelled", "replaced"] as const) {
      expect(occupiesSeat(s)).toBe(false);
    }
  });

  it("needsSeat nur beim Eintritt in die Belegung", () => {
    expect(needsSeat("requested", "approved_unpaid")).toBe(true);
    expect(needsSeat("waitlisted", "approved_unpaid")).toBe(true);
    expect(needsSeat("expired", "paid")).toBe(true);
    expect(needsSeat("approved_unpaid", "paid")).toBe(false);
    expect(needsSeat("checked_out", "checked_in")).toBe(false);
  });
});

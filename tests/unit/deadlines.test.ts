import { describe, expect, it } from "vitest";
import {
  canMoveUpFromWaitlist,
  canSelfCancel,
  computePaymentDeadline,
  doorWindow,
  isDeadlinePassed,
  isRegistrationOpen,
  reminderDueAt,
} from "@/domain/deadlines";

const party = {
  startsAt: new Date("2027-03-14T21:00:00Z"),
  endsAt: new Date("2027-03-15T05:00:00Z"),
  paymentDeadlineMinutes: 60,
};

describe("Zahlungsfrist", () => {
  it("Freigabe + 60 min, wenn genug Zeit ist", () => {
    const approved = new Date("2027-03-10T12:00:00Z");
    expect(computePaymentDeadline(approved, party, 24)?.toISOString()).toBe("2027-03-10T13:00:00.000Z");
  });

  it("gekappt auf Beginn − Cutoff", () => {
    const approved = new Date("2027-03-13T20:30:00Z"); // 24 h vor Beginn = 13.03. 21:00
    expect(computePaymentDeadline(approved, party, 24)?.toISOString()).toBe("2027-03-13T21:00:00.000Z");
  });

  it("nutzt „Zahlungen akzeptiert bis“ der Party statt Cutoff", () => {
    const p = { ...party, paymentsAcceptedUntil: new Date("2027-03-14T18:00:00Z") };
    const approved = new Date("2027-03-14T17:30:00Z");
    expect(computePaymentDeadline(approved, p, 24)?.toISOString()).toBe("2027-03-14T18:00:00.000Z");
  });

  it("null, wenn keine Zahlung mehr möglich", () => {
    expect(computePaymentDeadline(new Date("2027-03-14T10:00:00Z"), party, 24)).toBeNull();
  });

  it("Frist abgelaufen erst nach dem Zeitpunkt", () => {
    const d = new Date("2027-03-10T13:00:00Z");
    expect(isDeadlinePassed(d, new Date("2027-03-10T13:00:00Z"))).toBe(false);
    expect(isDeadlinePassed(d, new Date("2027-03-10T13:00:01Z"))).toBe(true);
    expect(isDeadlinePassed(null, new Date())).toBe(false);
  });

  it("Erinnerung nach 40 min, nicht wenn Frist kürzer", () => {
    const a = new Date("2027-03-10T12:00:00Z");
    expect(reminderDueAt(a, new Date("2027-03-10T13:00:00Z"), 40)?.toISOString()).toBe("2027-03-10T12:40:00.000Z");
    expect(reminderDueAt(a, new Date("2027-03-10T12:30:00Z"), 40)).toBeNull();
  });
});

describe("Weitere Fristen", () => {
  it("Anmeldung bis Anmeldeschluss bzw. Beginn", () => {
    expect(isRegistrationOpen(party, new Date("2027-03-14T20:59:00Z"))).toBe(true);
    expect(isRegistrationOpen(party, new Date("2027-03-14T21:00:00Z"))).toBe(false);
    const p = { ...party, registrationClosesAt: new Date("2027-03-12T00:00:00Z") };
    expect(isRegistrationOpen(p, new Date("2027-03-12T00:00:01Z"))).toBe(false);
  });

  it("Nachrücken nur bis 24 h vorher", () => {
    expect(canMoveUpFromWaitlist(party, new Date("2027-03-13T20:59:00Z"), 24)).toBe(true);
    expect(canMoveUpFromWaitlist(party, new Date("2027-03-13T21:00:00Z"), 24)).toBe(false);
  });

  it("Selbst-Storno bis 72 h vorher", () => {
    expect(canSelfCancel(party, new Date("2027-03-11T20:59:00Z"), 72)).toBe(true);
    expect(canSelfCancel(party, new Date("2027-03-11T21:00:00Z"), 72)).toBe(false);
  });

  it("Door-Fenster: Beginn − 2 h bis Ende + 6 h", () => {
    const w = doorWindow(party);
    expect(w.from.toISOString()).toBe("2027-03-14T19:00:00.000Z");
    expect(w.to.toISOString()).toBe("2027-03-15T11:00:00.000Z");
  });
});

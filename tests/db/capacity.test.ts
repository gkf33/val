import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { capacitySnapshot, transitionGuests, withPartyLock } from "@/server/capacity";
import { CapacityError } from "@/domain/capacity";
import { TransitionError } from "@/domain/guestStatus";
import { makeBooking, makeParty } from "./helpers";

afterAll(() => prisma.$disconnect());

describe("Kapazität mit Locking", () => {
  it("Crew und unbezahlte Freigaben zählen zur Belegung", async () => {
    const party = await makeParty(10);
    await prisma.guest.create({ data: { partyId: party.id, name: "DJ", type: "crew", status: "paid" } });
    await makeBooking(party.id, 2, "approved_unpaid");
    await makeBooking(party.id, 3, "requested");
    await makeBooking(party.id, 1, "expired");
    const snap = await capacitySnapshot(prisma, party.id);
    expect(snap.occupied).toBe(3);
    expect(snap.free).toBe(7);
  });

  it("Freigabe über die Grenze wird abgelehnt", async () => {
    const party = await makeParty(3);
    const b1 = await makeBooking(party.id, 2);
    const b2 = await makeBooking(party.id, 2);
    await withPartyLock(party.id, (tx) => transitionGuests(tx, party.id, b1.guests.map((g) => g.id), "approved_unpaid"));
    await expect(
      withPartyLock(party.id, (tx) => transitionGuests(tx, party.id, b2.guests.map((g) => g.id), "approved_unpaid")),
    ).rejects.toBeInstanceOf(CapacityError);
    // Teilfreigabe passt noch
    await withPartyLock(party.id, (tx) => transitionGuests(tx, party.id, [b2.guests[0].id], "approved_unpaid"));
    expect((await capacitySnapshot(prisma, party.id)).free).toBe(0);
  });

  it("gleichzeitige Freigaben überbuchen nie", async () => {
    const party = await makeParty(10);
    const bookings = await Promise.all(Array.from({ length: 8 }, () => makeBooking(party.id, 3)));
    const results = await Promise.allSettled(
      bookings.map((b) =>
        withPartyLock(party.id, (tx) => transitionGuests(tx, party.id, b.guests.map((g) => g.id), "approved_unpaid")),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toBe(3); // 3 × 3 = 9 ≤ 10, die vierte Gruppe passt nicht mehr
    for (const f of failed) expect((f as PromiseRejectedResult).reason).toBeInstanceOf(CapacityError);
    const snap = await capacitySnapshot(prisma, party.id);
    expect(snap.occupied).toBe(9);
  });

  it("Statusmaschine wird auch in der DB-Schicht erzwungen", async () => {
    const party = await makeParty(10);
    const b = await makeBooking(party.id, 1, "approved_unpaid");
    await expect(
      withPartyLock(party.id, (tx) => transitionGuests(tx, party.id, [b.guests[0].id], "checked_in")),
    ).rejects.toBeInstanceOf(TransitionError);
  });

  it("Gäste einer fremden Party werden abgewiesen", async () => {
    const p1 = await makeParty(10);
    const p2 = await makeParty(10);
    const b = await makeBooking(p2.id, 1);
    await expect(
      withPartyLock(p1.id, (tx) => transitionGuests(tx, p1.id, [b.guests[0].id], "approved_unpaid")),
    ).rejects.toThrow(/gehört nicht/);
  });
});

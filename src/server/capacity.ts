/**
 * Kapazität mit DB-Locking. Jede Operation, die Plätze belegt, läuft über
 * `withPartyLock`: SELECT … FOR UPDATE auf die Party-Zeile serialisiert
 * gleichzeitige Freigaben derselben Party.
 */
import type { GuestStatus as DbGuestStatus } from "@prisma/client";
import { assertFits, freeSeats, type CapacitySnapshot } from "@/domain/capacity";
import { OCCUPYING_STATUSES, assertTransition, needsSeat, type GuestStatus } from "@/domain/guestStatus";
import { prisma, type Db, type Tx } from "./db";
import { issueTickets } from "./tickets";

export async function occupiedSeats(db: Db, partyId: string): Promise<number> {
  return db.guest.count({
    where: { partyId, status: { in: OCCUPYING_STATUSES as DbGuestStatus[] } },
  });
}

export async function capacitySnapshot(db: Db, partyId: string): Promise<CapacitySnapshot & { free: number }> {
  const party = await db.party.findUniqueOrThrow({ where: { id: partyId }, select: { capacity: true } });
  const occupied = await occupiedSeats(db, partyId);
  const snap = { capacity: party.capacity, occupied };
  return { ...snap, free: freeSeats(snap) };
}

export async function withPartyLock<T>(partyId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Party" WHERE id = ${partyId} FOR UPDATE`;
      if (rows.length === 0) throw new Error("Party nicht gefunden");
      return fn(tx);
    },
    { timeout: 15000 },
  );
}

/**
 * Setzt den Status mehrerer Gäste einer Party atomar. Prüft Statusmaschine
 * und Kapazität. Wirft CapacityError, wenn die Obergrenze überschritten würde.
 */
export async function transitionGuests(
  tx: Tx,
  partyId: string,
  guestIds: string[],
  to: GuestStatus,
  extra: { checkedInAt?: Date; checkedInDevice?: string } = {},
): Promise<void> {
  const guests = await tx.guest.findMany({ where: { id: { in: guestIds }, partyId } });
  if (guests.length !== guestIds.length) throw new Error("Gast gehört nicht zu dieser Party");

  let seatsNeeded = 0;
  for (const g of guests) {
    assertTransition(g.status as GuestStatus, to);
    if (needsSeat(g.status as GuestStatus, to)) seatsNeeded++;
  }
  if (seatsNeeded > 0) {
    const snap = await capacitySnapshot(tx, partyId);
    assertFits(snap, seatsNeeded);
  }
  const now = new Date();
  await tx.guest.updateMany({
    where: { id: { in: guestIds } },
    data: { status: to as DbGuestStatus, statusChangedAt: now, ...extra },
  });
  if (to === "paid") await issueTickets(tx, guestIds);
}

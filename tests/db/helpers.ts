import { prisma } from "@/server/db";
import { generateReferenceCode } from "@/domain/codes";
import type { GuestStatus } from "@prisma/client";

export async function makeParty(capacity: number) {
  const start = new Date(Date.now() + 10 * 86_400_000);
  return prisma.party.create({
    data: {
      name: "Test",
      slug: `test-${Math.random().toString(36).slice(2, 10)}`,
      status: "open",
      startsAt: start,
      endsAt: new Date(start.getTime() + 6 * 3_600_000),
      capacity,
      feeCents: 2000,
    },
  });
}

export async function makeBooking(partyId: string, n: number, status: GuestStatus = "requested") {
  return prisma.booking.create({
    data: {
      partyId,
      email: `${Math.random().toString(36).slice(2)}@example.com`,
      bookerName: "Gast",
      referenceCode: generateReferenceCode(),
      guests: {
        create: Array.from({ length: n }, (_, i) => ({ partyId, name: `Gast ${i}`, status, adultConfirmed: true })),
      },
    },
    include: { guests: true },
  });
}

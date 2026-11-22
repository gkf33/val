import type { GuestStatus } from "@prisma/client";
import { prisma } from "./db";
import type { Occupancy } from "@/components/admin/OccupancyBar";

const PAID: GuestStatus[] = ["paid", "checked_in", "checked_out"];
const UNPAID: GuestStatus[] = ["approved_unpaid", "payment_mismatch"];

/** Belegung je Party, aufgeteilt für die Anzeige. */
export async function occupancyByParty(partyIds: string[]): Promise<Record<string, Occupancy & { requested: number; waitlisted: number }>> {
  const [parties, groups] = await Promise.all([
    prisma.party.findMany({ where: { id: { in: partyIds } }, select: { id: true, capacity: true } }),
    prisma.guest.groupBy({
      by: ["partyId", "status", "type"],
      where: { partyId: { in: partyIds } },
      _count: { _all: true },
    }),
  ]);
  const out: Record<string, Occupancy & { requested: number; waitlisted: number }> = {};
  for (const p of parties) out[p.id] = { capacity: p.capacity, paid: 0, unpaid: 0, crew: 0, requested: 0, waitlisted: 0 };
  for (const g of groups) {
    const o = out[g.partyId];
    const n = g._count._all;
    const occupying = PAID.includes(g.status) || UNPAID.includes(g.status);
    if (g.type === "crew" && occupying) o.crew += n;
    else if (PAID.includes(g.status)) o.paid += n;
    else if (UNPAID.includes(g.status)) o.unpaid += n;
    else if (g.status === "requested") o.requested += n;
    else if (g.status === "waitlisted") o.waitlisted += n;
  }
  return out;
}

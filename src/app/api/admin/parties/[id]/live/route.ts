import { NextResponse } from "next/server";
import { getAdmin } from "@/server/auth/session";
import { doorStats } from "@/server/door";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdmin())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const stats = await doorStats(id);
  const recent = await prisma.guest.findMany({
    where: { partyId: id, checkedInAt: { not: null } },
    orderBy: { statusChangedAt: "desc" },
    take: 15,
    select: { name: true, status: true, statusChangedAt: true, checkedInDevice: true, type: true },
  });
  const inside = await prisma.guest.groupBy({ by: ["gender"], where: { partyId: id, status: "checked_in" }, _count: { _all: true } });
  const genders = { m: 0, w: 0, d: 0, unknown: 0 };
  for (const g of inside) genders[(g.gender ?? "unknown") as keyof typeof genders] += g._count._all;
  return NextResponse.json({ ...stats, recent, genders });
}

import { getAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { audit } from "@/server/audit";
import { formatDateTime } from "@/domain/time";
import { STATUS_LABEL, type GuestStatus } from "@/domain/guestStatus";

export const dynamic = "force-dynamic";

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Formel-Injektion in Tabellenprogrammen verhindern
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin) return new Response("unauthorized", { status: 401 });
  const { id } = await params;
  const party = await prisma.party.findUniqueOrThrow({ where: { id } });
  const guests = await prisma.guest.findMany({
    where: { partyId: id, status: { in: ["paid", "checked_in", "checked_out", "approved_unpaid", "payment_mismatch"] } },
    include: { booking: { include: { viaLink: true } } },
    orderBy: { name: "asc" },
  });
  const tz = config.timeZone;
  const rows = [
    ["Drinnen", "Name", "Typ", "Status", "Bucher", "Referenz", "Über", "Check-in"],
    ...guests.map((g) => [
      g.status === "checked_in" ? "x" : "",
      g.name,
      g.type === "crew" ? `Crew${g.role ? ` (${g.role})` : ""}` : "Gast",
      STATUS_LABEL[g.status as GuestStatus],
      g.booking?.bookerName ?? "",
      g.booking?.referenceCode ?? "",
      g.booking?.viaLink?.type === "inviter" ? g.booking.viaLink.inviterLabel : "",
      g.checkedInAt ? `${formatDateTime(g.checkedInAt, tz)} ${g.checkedInDevice ?? ""}` : "",
    ]),
  ];
  await audit({ type: "admin", label: admin.email }, "guests.export_csv", { partyId: id, data: { rows: guests.length } });
  const csv = "﻿" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="gaesteliste-${party.slug}.csv"`,
      "cache-control": "no-store",
    },
  });
}

import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { audit } from "@/server/audit";
import { formatDateTime } from "@/domain/time";
import { PrintButton } from "@/components/admin/PrintButton";

export const dynamic = "force-dynamic";

// Druckansicht (hell) als Offline-Absicherung an der Tür.
export default async function PrintList({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const party = await prisma.party.findUnique({ where: { id } });
  if (!party) notFound();
  const guests = await prisma.guest.findMany({
    where: { partyId: id, status: { in: ["paid", "checked_in", "checked_out"] } },
    include: { booking: { select: { referenceCode: true } } },
    orderBy: { name: "asc" },
  });
  await audit({ type: "admin", label: admin.email }, "guests.export_print", { partyId: id, data: { rows: guests.length } });
  return (
    <main className="min-h-dvh bg-white p-6 font-sans text-black">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{party.name} · Gästeliste</h1>
          <p className="text-sm">
            {formatDateTime(party.startsAt, config.timeZone)} · {guests.length} Personen · Stand {formatDateTime(new Date(), config.timeZone)}
          </p>
        </div>
        <PrintButton />
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-black text-left">
            <th className="w-10 py-1">✓</th>
            <th className="py-1">Name</th>
            <th className="w-10 py-1">m/w/d</th>
            <th className="py-1">Typ</th>
            <th className="py-1">Ref</th>
          </tr>
        </thead>
        <tbody>
          {guests.map((g) => (
            <tr key={g.id} className="border-b border-gray-300 break-inside-avoid">
              <td className="py-1.5">
                <span className="inline-block size-4 border border-black align-middle">{g.status === "checked_in" ? "×" : ""}</span>
              </td>
              <td className="py-1.5 font-medium">{g.name}</td>
              <td className="py-1.5">{g.gender ?? ""}</td>
              <td className="py-1.5">{g.type === "crew" ? `Crew${g.role ? ` · ${g.role}` : ""}` : ""}</td>
              <td className="py-1.5 font-mono text-xs">{g.booking?.referenceCode ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { LiveBoard } from "@/components/admin/LiveBoard";

export default async function LivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const party = await prisma.party.findUnique({ where: { id } });
  if (!party) notFound();
  return (
    <div className="flex flex-col gap-5">
      <Link href={`/admin/parties/${id}`} className="text-xs text-muted no-underline">← {party.name}</Link>
      <h1 className="text-lg font-semibold">Live-Belegung</h1>
      <LiveBoard partyId={id} />
    </div>
  );
}

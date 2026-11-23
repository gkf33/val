import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/server/db";
import { capacitySnapshot } from "@/server/capacity";
import { addCrewAction, removeCrewAction } from "@/app/admin/actions";

export const dynamic = "force-dynamic";

export default async function CrewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string }> }) {
  const { id } = await params;
  const { err } = await searchParams;
  const party = await prisma.party.findUnique({ where: { id } });
  if (!party) notFound();
  const [crew, snap] = await Promise.all([
    prisma.guest.findMany({ where: { partyId: id, type: "crew", status: { not: "cancelled" } }, orderBy: { createdAt: "asc" } }),
    capacitySnapshot(prisma, id),
  ]);
  const field = "min-h-11 min-w-0 rounded-[2px] border border-line-2 bg-surface-2 px-3 text-sm";
  return (
    <div className="flex flex-col gap-5">
      <Link href={`/admin/parties/${id}`} className="text-xs text-muted no-underline">← {party.name}</Link>
      <h1 className="text-lg font-semibold">Crew &amp; Freiliste</h1>
      <p className="text-sm text-fg-2">
        Belegt einen Platz, zahlt nichts. Frei: <span className="font-semibold text-fg">{snap.free}</span> / {snap.capacity}
      </p>
      {err && <p className="border border-warn p-3 text-sm text-warn">▲ {err}</p>}
      <form action={addCrewAction.bind(null, id)} className="grid gap-2 sm:grid-cols-[2fr_1fr_auto_2fr_auto]">
        <label className="sr-only" htmlFor="crew-name">Name</label>
        <input id="crew-name" name="name" placeholder="Name wie im Ausweis" required className={field} />
        <label className="sr-only" htmlFor="crew-role">Rolle</label>
        <input id="crew-role" name="role" placeholder="Rolle (DJ, Bar …)" className={field} />
        <label className="sr-only" htmlFor="crew-gender">Geschlecht</label>
        <select id="crew-gender" name="gender" defaultValue="" className={field}>
          <option value="">m/w/d</option>
          <option value="m">m</option>
          <option value="w">w</option>
          <option value="d">d</option>
        </select>
        <label className="sr-only" htmlFor="crew-mail">E-Mail</label>
        <input id="crew-mail" name="email" type="email" placeholder="E-Mail (optional)" className={field} />
        <button className="min-h-11 bg-accent px-4 text-sm font-semibold text-on-accent">+ Hinzufügen</button>
      </form>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {crew.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span>
              {c.name} {c.gender && <span className="ml-1 text-xs text-muted">{c.gender}</span>} {c.role && <span className="ml-2 bg-line-2 px-2 py-0.5 text-[11px] text-fg-2">{c.role}</span>}
            </span>
            <form action={removeCrewAction.bind(null, id, c.id)}>
              <button className="min-h-11 text-xs text-warn underline">Entfernen</button>
            </form>
          </li>
        ))}
        {crew.length === 0 && <li className="py-3 text-sm text-muted">Noch keine Crew.</li>}
      </ul>
    </div>
  );
}

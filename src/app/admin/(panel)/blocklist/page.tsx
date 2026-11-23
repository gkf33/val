import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { formatDateTime } from "@/domain/time";
import { addBlockAction, removeBlockAction } from "@/app/admin/phase5Actions";

export const dynamic = "force-dynamic";

export default async function BlocklistPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const { err } = await searchParams;
  const list = await prisma.blocklist.findMany({ orderBy: { createdAt: "desc" } });
  const field = "min-h-11 min-w-0 border border-line-2 bg-surface-2 px-3 text-sm";
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Sperrliste</h1>
      <p className="text-xs text-muted">Treffer über Name (ohne Groß-/Kleinschreibung, Umlaute, Akzente) oder E-Mail. Warnung in der Freigabe, rot am Scanner. Bleibt beim Löschjob erhalten.</p>
      <form action={addBlockAction} className="grid gap-2 sm:grid-cols-[2fr_2fr_2fr_auto]">
        <label htmlFor="bl-name" className="sr-only">Name</label>
        <input id="bl-name" name="name" placeholder="Name" className={field} />
        <label htmlFor="bl-mail" className="sr-only">E-Mail</label>
        <input id="bl-mail" name="email" type="email" placeholder="E-Mail" className={field} />
        <label htmlFor="bl-reason" className="sr-only">Grund</label>
        <input id="bl-reason" name="reason" placeholder="Grund (intern)" className={field} />
        <button className="min-h-11 bg-accent px-4 text-sm font-semibold text-on-accent">+ Sperren</button>
      </form>
      {err && <p className="text-sm text-warn">▲ {decodeURIComponent(err)}</p>}
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {list.map((b) => (
          <li key={b.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              {b.name ?? "—"} {b.email && <span className="text-muted">· {b.email}</span>}
              <span className="block text-[11px] text-muted">
                {b.reason ?? "ohne Grund"} · {formatDateTime(b.createdAt, config.timeZone)}
              </span>
            </span>
            <form action={removeBlockAction.bind(null, b.id)}>
              <button className="min-h-11 px-2 text-xs underline">Entfernen</button>
            </form>
          </li>
        ))}
        {list.length === 0 && <li className="py-3 text-sm text-muted">Leer.</li>}
      </ul>
    </div>
  );
}

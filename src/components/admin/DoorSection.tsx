import Link from "next/link";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { formatDateTime } from "@/domain/time";
import { CopyButton } from "@/components/CopyButton";
import { createDoorLinkAction, revokeDeviceAction, revokeDoorLinkAction, setOfflinePrimaryAction } from "@/app/admin/doorActions";

export async function DoorSection({ partyId, error }: { partyId: string; error?: string }) {
  const tz = config.timeZone;
  const links = await prisma.partyLink.findMany({
    where: { partyId, type: "door", active: true },
    include: { devices: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  const btn = "min-h-11 border border-line-3 px-3 text-xs hover:border-accent";
  return (
    <section id="einlass" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Einlass</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={`/admin/parties/${partyId}/live`} className="flex min-h-11 items-center border border-line-3 px-3 text-fg no-underline hover:border-accent">
            Live-Belegung
          </Link>
          <a href={`/api/admin/parties/${partyId}/guests.csv`} className="flex min-h-11 items-center border border-line-3 px-3 text-fg no-underline hover:border-accent">
            Gästeliste CSV
          </a>
          <Link href={`/admin/print/${partyId}`} className="flex min-h-11 items-center border border-line-3 px-3 text-fg no-underline hover:border-accent">
            Gästeliste PDF
          </Link>
        </div>
      </div>
      {links.map((l) => {
        const url = `${config.appUrl}/door/${l.code}`;
        const devices = l.devices.filter((d) => !d.revokedAt);
        return (
          <div key={l.id} className="flex flex-col gap-2 border border-line-2 bg-surface p-3">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs">{url}</code>
              <CopyButton value={url} />
            </div>
            <p className="text-[11px] text-muted">
              gültig {l.validFrom && formatDateTime(l.validFrom, tz)} – {l.validTo && formatDateTime(l.validTo, tz)} · PIN separat weitergeben
            </p>
            <ul className="flex flex-col divide-y divide-line">
              {devices.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="flex-1">
                    {d.name}
                    {d.offlinePrimary && <span className="ml-2 bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-on-accent">OFFLINE-HAUPTGERÄT</span>}
                    <span className="block text-[11px] text-muted">zuletzt {d.lastSeenAt ? formatDateTime(d.lastSeenAt, tz) : "—"}</span>
                  </span>
                  {!d.offlinePrimary && (
                    <form action={setOfflinePrimaryAction.bind(null, partyId, d.id)}>
                      <button className={btn}>Offline-Hauptgerät</button>
                    </form>
                  )}
                  <form action={revokeDeviceAction.bind(null, partyId, d.id)}>
                    <button className="min-h-11 px-2 text-xs text-warn underline">Sperren</button>
                  </form>
                </li>
              ))}
              {devices.length === 0 && <li className="py-2 text-xs text-muted">Noch kein Gerät angemeldet.</li>}
            </ul>
            <form action={revokeDoorLinkAction.bind(null, partyId, l.id)}>
              <button className="min-h-11 text-xs text-warn underline">Door-Link widerrufen (alle Geräte)</button>
            </form>
          </div>
        );
      })}
      <form action={createDoorLinkAction.bind(null, partyId)} className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor="door-pin" className="text-xs text-fg-2">PIN für neuen Door-Link (4–8 Ziffern)</label>
          <input id="door-pin" name="pin" inputMode="numeric" pattern="\d{4,8}" required className="min-h-11 w-40 border border-line-2 bg-surface-2 px-3 font-mono tracking-widest" />
        </div>
        <button className={btn}>+ Door-Link</button>
      </form>
      {error && <p className="text-xs text-warn">▲ {error}</p>}
    </section>
  );
}

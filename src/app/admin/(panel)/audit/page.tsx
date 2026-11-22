import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { formatDateTime } from "@/domain/time";

export default async function AuditPage() {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Audit-Log</h1>
      <p className="text-xs text-muted">Letzte 200 Einträge aller Admin-, Door- und Systemaktionen.</p>
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-baseline sm:gap-4">
            <span className="w-36 shrink-0 text-xs text-muted">{formatDateTime(r.createdAt, config.timeZone)}</span>
            <span className="font-mono text-xs text-accent-2">{r.action}</span>
            <span className="text-xs text-fg-2">{r.actorLabel}</span>
            {r.data ? <span className="truncate font-mono text-[11px] text-muted">{JSON.stringify(r.data)}</span> : null}
          </li>
        ))}
        {rows.length === 0 && <li className="py-3 text-sm text-muted">Noch keine Einträge.</li>}
      </ul>
    </div>
  );
}

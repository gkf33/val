import { notFound } from "next/navigation";
import { resolvePartyLink } from "@/server/parties";
import { partyFinance } from "@/server/reports";
import { config } from "@/server/config";
import { formatDate } from "@/domain/time";
import { formatEuro } from "@/domain/money";
import { FinanceSummary } from "@/components/admin/FinanceSummary";

export const dynamic = "force-dynamic";

export default async function TransparencyPage({ params }: { params: Promise<{ segment: string }> }) {
  const { segment } = await params;
  const link = await resolvePartyLink(segment);
  if (!link || !link.party.transparencyPublic) notFound();
  const f = await partyFinance(link.party.id);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 py-7">
      <p className="text-[13px] text-muted">PS&gt; transparenz --{formatDate(link.party.startsAt, config.timeZone).toLowerCase().replace(" ", "-")}</p>
      <h1 className="text-2xl font-bold">Kein Gewinn.</h1>
      <p className="text-sm leading-relaxed text-fg-2">Private Veranstaltung. Der Unkostenbeitrag deckt nur die Kosten.</p>
      <section className="border border-line-2 bg-surface p-4">
        <FinanceSummary f={f} />
      </section>
      {f.costs.length > 0 && (
        <section className="flex flex-col gap-1 text-sm">
          <p className="text-xs text-muted">{"// kosten"}</p>
          {f.costs.map((c) => (
            <div key={c.id} className="flex justify-between border-b border-line py-1.5">
              <span className="text-fg-2">{c.label}</span>
              <span>{formatEuro(c.amountCents)}</span>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

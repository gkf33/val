import { formatEuro } from "@/domain/money";

export function FinanceSummary({ f }: { f: { incomeCents: number; refundCents: number; costCents: number; balanceCents: number } }) {
  const row = (label: string, v: number, strong = false) => (
    <div className={`flex justify-between py-1.5 ${strong ? "border-t border-line-3 font-semibold" : ""}`}>
      <span className={strong ? "" : "text-fg-2"}>{label}</span>
      <span>{formatEuro(v)}</span>
    </div>
  );
  return (
    <div className="flex flex-col text-sm">
      {row("Einnahmen (Unkostenbeiträge)", f.incomeCents)}
      {row("− Erstattungen", f.refundCents)}
      {row("− Kosten", f.costCents)}
      {row("= Saldo", f.balanceCents, true)}
    </div>
  );
}

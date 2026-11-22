import { parsePaypalCsv } from "@/domain/paypalCsv";
import { audit, type Actor } from "../audit";
import { recordPayment } from "./apply";

export interface CsvImportReport {
  rows: number;
  skipped: number;
  duplicates: number;
  paid: number;
  other: number;
  missingColumns: string[];
}

/** Importiert den PayPal-Aktivitätenexport; bereits verbuchte Transaktionen werden erkannt. */
export async function importPaypalCsv(actor: Actor, text: string): Promise<CsvImportReport> {
  const { payments, skipped, missingColumns } = parsePaypalCsv(text);
  const report: CsvImportReport = { rows: payments.length, skipped, duplicates: 0, paid: 0, other: 0, missingColumns };
  for (const p of payments) {
    const r = await recordPayment({
      paypalTxId: p.txId,
      grossCents: p.grossCents,
      feeCents: p.feeCents,
      currency: p.currency,
      senderName: p.senderName,
      senderEmail: p.senderEmail,
      note: p.note,
      paidAt: p.paidAt,
      source: "csv",
      trusted: true, // Export aus dem eigenen Konto
    }, actor);
    if (r.status === "duplicate") report.duplicates++;
    else if (r.status === "paid") report.paid++;
    else report.other++;
  }
  await audit(actor, "payment.csv_import", { data: { ...report } });
  return report;
}

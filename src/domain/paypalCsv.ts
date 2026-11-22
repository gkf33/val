/**
 * PayPal-Aktivitätenexport (CSV). Spaltennamen variieren je Sprache/Export-Version,
 * daher Zuordnung über Synonyme. Ohne echten Export noch nicht verifiziert.
 */
import Papa from "papaparse";

export interface CsvPayment {
  txId: string;
  grossCents: number;
  feeCents: number | null;
  currency: string;
  senderName: string | null;
  senderEmail: string | null;
  note: string | null;
  paidAt: Date | null;
}

const COLS: Record<keyof CsvPayment | "status" | "type", string[]> = {
  txId: ["transaktionscode", "transaction id", "transaktions-id"],
  grossCents: ["brutto", "gross"],
  feeCents: ["gebühr", "gebuehr", "fee"],
  currency: ["währung", "waehrung", "currency"],
  senderName: ["name"],
  senderEmail: ["absender e-mail-adresse", "von e-mail-adresse", "from email address"],
  note: ["hinweis", "betreff", "nachricht", "mitteilung", "note", "subject"],
  paidAt: ["datum", "date"],
  status: ["status"],
  type: ["typ", "type", "beschreibung", "description"],
};

function amount(s: string | undefined): number | null {
  if (!s) return null;
  let t = s.replace(/[\s€"]/g, "");
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function date(s: string | undefined): Date | null {
  if (!s) return null;
  const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s.trim());
  if (de) return new Date(Date.UTC(+de[3], +de[2] - 1, +de[1], 12));
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (us) return new Date(Date.UTC(+us[3], +us[1] - 1, +us[2], 12));
  return null;
}

export function parsePaypalCsv(text: string): { payments: CsvPayment[]; skipped: number; missingColumns: string[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  const headers = (res.meta.fields ?? []).map((h) => h.trim());
  const find = (key: keyof typeof COLS) => headers.find((h) => COLS[key].includes(h.toLowerCase()));
  const col = Object.fromEntries(Object.keys(COLS).map((k) => [k, find(k as keyof typeof COLS)])) as Record<keyof typeof COLS, string | undefined>;
  const missingColumns = (["txId", "grossCents"] as const).filter((k) => !col[k]);
  if (missingColumns.length) return { payments: [], skipped: res.data.length, missingColumns };

  const payments: CsvPayment[] = [];
  let skipped = 0;
  for (const row of res.data) {
    const gross = amount(row[col.grossCents!]);
    const status = (col.status ? row[col.status] : "").toLowerCase();
    const txId = (row[col.txId!] ?? "").trim();
    const completed = !status || /abgeschlossen|completed/.test(status);
    if (!txId || gross === null || gross <= 0 || !completed) {
      skipped++;
      continue;
    }
    const fee = amount(col.feeCents ? row[col.feeCents] : undefined);
    payments.push({
      txId,
      grossCents: gross,
      feeCents: fee === null ? null : Math.abs(fee),
      currency: (col.currency ? row[col.currency] : "EUR")?.trim() || "EUR",
      senderName: (col.senderName ? row[col.senderName] : "")?.trim() || null,
      senderEmail: (col.senderEmail ? row[col.senderEmail] : "")?.trim().toLowerCase() || null,
      note: (col.note ? row[col.note] : "")?.trim() || null,
      paidAt: date(col.paidAt ? row[col.paidAt] : undefined),
    });
  }
  return { payments, skipped, missingColumns };
}

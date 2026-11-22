/**
 * Parser für PayPal-Benachrichtigungen (Empfängerseite, „Zahlung erhalten“).
 * Arbeitet auf dem HTML bzw. Text der Mail, ohne Netz und ohne DB.
 * Varianten: de-DE/de-AT (echt verifiziert), en (synthetisch, unverifiziert).
 */

export interface ParsedPayment {
  kind: "received";
  grossCents: number;
  feeCents: number | null;
  currency: string;
  senderName: string | null;
  note: string | null;
  txId: string;
  paidAt: Date | null;
  locale: "de" | "en";
}

export interface IgnoredMail {
  kind: "ignored";
  reason: string;
}

export type ParseResult = ParsedPayment | IgnoredMail | { kind: "error"; reason: string };

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  euro: "€",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
};

export function htmlToLines(html: string): string[] {
  const text = html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|td|tr|li|h\d|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n] ?? m);
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/[\s  ]+/g, " ").trim())
    .filter(Boolean);
}

/** „1.234,50“ (de) bzw. „1,234.50“ (en) → Cent. */
export function parseAmount(raw: string, locale: "de" | "en"): number | null {
  const s = raw.replace(/[€\s]|EUR/g, "");
  let norm: string;
  if (locale === "de") norm = s.replace(/\./g, "").replace(",", ".");
  else norm = s.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(norm)) return null;
  return Math.round(parseFloat(norm) * 100);
}

const AMOUNT = String.raw`(?:€\s*)?([\d.,]+)\s*(EUR|USD|CHF|GBP)`;
const RECEIVED = {
  de: new RegExp(String.raw`^(.+?) hat Ihnen ${AMOUNT} gesendet`),
  en: new RegExp(String.raw`^(.+?) sent you ${AMOUNT}`),
};
const LABELS = {
  de: { tx: /^Transaktionscode$/i, date: /^Transaktionsdatum$/i, amount: /^Erhaltener Betrag$/i, fee: /^Gebühr$/i, note: /^Mitteilung von (.+)$/i },
  en: { tx: /^Transaction ID$/i, date: /^Transaction date$/i, amount: /^Amount received$/i, fee: /^Fee$/i, note: /^Note from (.+)$/i },
};
const NOTE_END = /^(Sie sehen das Geld nicht|Don't see the money|Mehr erfahren|Learn more|Transaktions|Transaction|Hilfe & Kontakt|Help & Contact|Wie wahrscheinlich|How likely)/i;
const TX_ID = /^[0-9A-Z]{17}$/;

const DE_MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function parseDate(s: string, locale: "de" | "en"): Date | null {
  if (locale === "de") {
    const m = /^(\d{1,2})\.\s*([A-Za-zäÄ]+)\s+(\d{4})$/.exec(s);
    const mon = m ? DE_MONTHS.indexOf(m[2].toLowerCase()) : -1;
    return m && mon >= 0 ? new Date(Date.UTC(+m[3], mon, +m[1], 12)) : null;
  }
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s);
  const mon = m ? EN_MONTHS.indexOf(m[1].toLowerCase()) : -1;
  return m && mon >= 0 ? new Date(Date.UTC(+m[3], mon, +m[2], 12)) : null;
}

export function parsePaypalMail(input: { subject: string; html?: string | null; text?: string | null }): ParseResult {
  const lines = input.html ? htmlToLines(input.html) : (input.text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const subject = input.subject.trim();

  let locale: "de" | "en" | null = null;
  let headline: RegExpExecArray | null = null;
  for (const l of lines) {
    for (const loc of ["de", "en"] as const) {
      const m = RECEIVED[loc].exec(l);
      if (m) {
        locale = loc;
        headline = m;
        break;
      }
    }
    if (headline) break;
  }
  if (!locale || !headline) {
    return { kind: "ignored", reason: `Keine Zahlungseingangs-Mail (${subject || "ohne Betreff"})` };
  }
  const L = LABELS[locale];
  const after = (re: RegExp): string | null => {
    const i = lines.findIndex((l) => re.test(l));
    return i >= 0 && i + 1 < lines.length ? lines[i + 1] : null;
  };

  const txLine = after(L.tx);
  const txId = txLine && TX_ID.test(txLine) ? txLine : null;
  if (!txId) return { kind: "error", reason: "Transaktionscode nicht gefunden" };

  const currency = headline[3];
  const amountLine = after(L.amount);
  const grossCents = parseAmount(amountLine ?? headline[2], locale) ?? parseAmount(headline[2], locale);
  if (grossCents === null) return { kind: "error", reason: "Betrag nicht lesbar" };

  const feeLine = after(L.fee);
  const feeCents = feeLine ? parseAmount(feeLine, locale) : null;

  let note: string | null = null;
  let noteSender: string | null = null;
  const ni = lines.findIndex((l) => L.note.test(l));
  if (ni >= 0) {
    noteSender = L.note.exec(lines[ni])![1].trim();
    const parts: string[] = [];
    for (let i = ni + 1; i < lines.length && !NOTE_END.test(lines[i]); i++) parts.push(lines[i]);
    note = parts.join(" ").trim() || null;
  }

  const dateLine = after(L.date);
  return {
    kind: "received",
    grossCents,
    feeCents,
    currency,
    senderName: headline[1].trim() || noteSender,
    note,
    txId,
    paidAt: dateLine ? parseDate(dateLine, locale) : null,
    locale,
  };
}

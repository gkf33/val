/**
 * Alle E-Mail-Texte zentral. Ton: knapp, kryptisch, Deutsch.
 */
import type { OutgoingMail } from "./mailer";
import { formatDate, formatDateTime, formatTime } from "@/domain/time";
import { formatEuro } from "@/domain/money";

const TZ = () => process.env.TZ_DISPLAY ?? "Europe/Berlin";

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

type Line = string | { code: string };

function layout(lines: Line[], cta?: { label: string; url: string }): string {
  const body = lines
    .map((l) =>
      typeof l === "string"
        ? `<p style="margin:0 0 14px">${escape(l)}</p>`
        : `<p style="margin:0 0 14px;font-size:22px;font-weight:700;letter-spacing:2px;color:#A99CFF">${escape(l.code)}</p>`,
    )
    .join("");
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escape(cta.url)}" style="display:inline-block;background:#8B7CF6;color:#0A0A0F;padding:14px 22px;text-decoration:none;font-weight:700;letter-spacing:1px">${escape(cta.label)}</a></p><p style="margin:0;font-size:12px;color:#8A8A9A;word-break:break-all">${escape(cta.url)}</p>`
    : "";
  return `<!doctype html><html lang="de"><body style="margin:0;background:#07070A"><div style="max-width:480px;margin:0 auto;padding:32px 20px;font-family:'Cascadia Code','JetBrains Mono',Consolas,monospace;color:#E6E6EE;font-size:15px;line-height:1.6"><p style="margin:0 0 24px;font-size:12px;color:#8A8A9A">PS&gt; _</p>${body}${button}</div></body></html>`;
}

function mail(to: string, subject: string, lines: Line[], cta?: { label: string; url: string }): OutgoingMail {
  const text = lines.map((l) => (typeof l === "string" ? l : l.code)).join("\n") + (cta ? `\n\n${cta.label}: ${cta.url}` : "");
  return { to, subject, text, html: layout(lines, cta) };
}

export interface PartyInfo {
  startsAt: Date;
  endsAt: Date;
}

function when(p: PartyInfo): string {
  return `${formatDate(p.startsAt, TZ())} · ${formatTime(p.startsAt, TZ())}`;
}

function names(list: string[]): string {
  return list.join(", ");
}

// ── Login ─────────────────────────────────────────────────

export function loginLinkMail(to: string, url: string): OutgoingMail {
  return mail(to, "Dein Zugang", ["Zugang angefordert.", "Der Link gilt 15 Minuten und nur einmal.", "Nicht angefordert? Ignorieren."], {
    label: "EINLOGGEN ▸",
    url,
  });
}

// ── Gäste-Flow ────────────────────────────────────────────

export function confirmEmailMail(to: string, url: string, party: PartyInfo, guests: string[]): OutgoingMail {
  return mail(
    to,
    "Bestätige deine Anfrage",
    [
      `Anfrage für ${when(party)}.`,
      `Personen: ${names(guests)}.`,
      "Erst mit dem Klick zählt die Anfrage. Der Link gilt 24 Stunden.",
      "Nicht angefragt? Ignorieren.",
    ],
    { label: "ANFRAGE BESTÄTIGEN ▸", url },
  );
}

export function requestReceivedMail(to: string, statusUrl: string, party: PartyInfo, guests: string[], feeCents: number): OutgoingMail {
  return mail(
    to,
    "Anfrage eingegangen",
    [
      `Anfrage für ${when(party)} ist eingegangen.`,
      `Personen: ${names(guests)}.`,
      "Absenden ist noch kein Einlass. Nach der Freigabe zahlst du den Unkostenbeitrag",
      `von ${formatEuro(feeCents)} pro Person. Mit der Zahlung erhältst du deinen QR-Code.`,
    ],
    { label: "STATUS ▸", url: statusUrl },
  );
}

export function waitlistMail(to: string, statusUrl: string, party: PartyInfo, guests: string[]): OutgoingMail {
  return mail(
    to,
    "Warteliste",
    [`${when(party)} ist voll.`, `Auf der Warteliste: ${names(guests)}.`, "Wird ein Platz frei, melden wir uns."],
    { label: "STATUS ▸", url: statusUrl },
  );
}

export function approvedMail(
  to: string,
  opts: {
    statusUrl: string;
    party: PartyInfo;
    guests: string[];
    amountCents: number;
    deadline: Date;
    referenceCode: string;
    paypalUrl: string | null;
  },
): OutgoingMail {
  return mail(
    to,
    "Freigegeben",
    [
      `Freigegeben für ${when(opts.party)}: ${names(opts.guests)}.`,
      `Unkostenbeitrag: ${formatEuro(opts.amountCents)}. Zahlen bis ${formatDateTime(opts.deadline, TZ())}.`,
      "Danach verfällt der Platz.",
      "Per PayPal. Als Nachricht nur diesen Code angeben:",
      { code: opts.referenceCode },
      "Mit der Zahlung erhältst du deinen QR-Code.",
    ],
    opts.paypalUrl ? { label: "MIT PAYPAL ZAHLEN ▸", url: opts.paypalUrl } : { label: "ZAHLUNG ▸", url: opts.statusUrl },
  );
}

export function paymentReminderMail(to: string, statusUrl: string, deadline: Date, referenceCode: string): OutgoingMail {
  return mail(
    to,
    "Erinnerung: Zahlung offen",
    [`Zahlung noch offen. Frist: ${formatDateTime(deadline, TZ())}.`, "Code als Nachricht:", { code: referenceCode }],
    { label: "ZAHLUNG ▸", url: statusUrl },
  );
}

export function expiredMail(to: string, statusUrl: string, guests: string[]): OutgoingMail {
  return mail(
    to,
    "Frist abgelaufen",
    [`Frist abgelaufen. Plätze freigegeben: ${names(guests)}.`, "Schon gezahlt? Wir melden uns."],
    { label: "STATUS ▸", url: statusUrl },
  );
}

export function rejectedMail(to: string, guests: string[], message?: string): OutgoingMail {
  return mail(to, "Keine Freigabe", [`Diesmal keine Freigabe für: ${names(guests)}.`, ...(message ? [message] : [])]);
}

// ── Admin ─────────────────────────────────────────────────

export function seatFreedAdminMail(to: string, adminUrl: string, partyName: string, free: number, waitlisted: number): OutgoingMail {
  return mail(
    to,
    `Platz frei · ${partyName}`,
    [`${partyName}: ${free} Platz/Plätze frei.`, `${waitlisted} auf der Warteliste. Nachrücken nur per Freigabe.`],
    { label: "QUEUE ▸", url: adminUrl },
  );
}

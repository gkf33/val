/**
 * Alle E-Mail-Texte zentral. Ton: knapp, kryptisch, Deutsch.
 * Weitere Templates folgen in den nächsten Phasen.
 */
import type { OutgoingMail } from "./mailer";

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function layout(lines: string[], cta?: { label: string; url: string }): string {
  const body = lines.map((l) => `<p style="margin:0 0 14px">${escape(l)}</p>`).join("");
  const button = cta
    ? `<p style="margin:24px 0"><a href="${escape(cta.url)}" style="display:inline-block;background:#8B7CF6;color:#0A0A0F;padding:14px 22px;text-decoration:none;font-weight:700;letter-spacing:1px">${escape(cta.label)}</a></p><p style="margin:0;font-size:12px;color:#8A8A9A;word-break:break-all">${escape(cta.url)}</p>`
    : "";
  return `<!doctype html><html lang="de"><body style="margin:0;background:#07070A"><div style="max-width:480px;margin:0 auto;padding:32px 20px;font-family:'Cascadia Code','JetBrains Mono',Consolas,monospace;color:#E6E6EE;font-size:15px;line-height:1.6"><p style="margin:0 0 24px;font-size:12px;color:#8A8A9A">PS&gt; _</p>${body}${button}</div></body></html>`;
}

export function loginLinkMail(to: string, url: string): OutgoingMail {
  const lines = ["Zugang angefordert.", "Der Link gilt 15 Minuten und nur einmal.", "Nicht angefordert? Ignorieren."];
  return {
    to,
    subject: "Dein Zugang",
    text: `${lines.join("\n")}\n\n${url}`,
    html: layout(lines, { label: "EINLOGGEN ▸", url }),
  };
}

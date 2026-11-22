/**
 * QR-Codes: Pro Gast ein zufälliges Ticket-Token. Der QR enthält nur
 * `<token>.<hmac>` (keine Klartextdaten); die Signatur verhindert geratene Codes.
 */
import QRCode from "qrcode";
import { config } from "./config";
import { hmac, randomToken, safeEqual, sha256 } from "./crypto";
import type { Db } from "./db";

export function signTicket(token: string): string {
  return `${token}.${hmac(config.appSecret, `ticket:${token}`).slice(0, 16)}`;
}

/** Prüft die Signatur und gibt das Token zurück (oder null). Akzeptiert auch die volle URL. */
export function verifyTicketPayload(input: string): string | null {
  const payload = input.trim().split("/").pop() ?? "";
  const [token, sig] = payload.split(".");
  if (!token || !sig || token.length < 16 || token.length > 64) return null;
  const expected = hmac(config.appSecret, `ticket:${token}`).slice(0, 16);
  return safeEqual(sig, expected) ? token : null;
}

export function ticketUrl(token: string): string {
  return `${config.appUrl}/t/${signTicket(token)}`;
}

export function ticketHash(token: string): string {
  return sha256(token);
}

export async function qrSvg(token: string): Promise<string> {
  return QRCode.toString(ticketUrl(token), { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#000000", light: "#ffffff" } });
}

/** Vergibt Tokens an Gäste ohne Token. */
export async function issueTickets(db: Db, guestIds: string[]): Promise<void> {
  const guests = await db.guest.findMany({ where: { id: { in: guestIds }, ticketToken: null }, select: { id: true } });
  for (const g of guests) await db.guest.update({ where: { id: g.id }, data: { ticketToken: randomToken(18) } });
}

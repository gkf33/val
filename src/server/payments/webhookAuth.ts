import { safeEqual } from "../crypto";

/**
 * Webhook-Absicherung: Basic Auth (INBOUND_BASIC_USER/INBOUND_BASIC_PASS)
 * oder Bearer-Token bzw. ?token= (INBOUND_WEBHOOK_SECRET).
 */
export function isAuthorizedWebhook(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const user = process.env.INBOUND_BASIC_USER;
  const pass = process.env.INBOUND_BASIC_PASS;
  if (user && pass && auth.startsWith("Basic ")) {
    const expected = Buffer.from(`${user}:${pass}`).toString("base64");
    if (safeEqual(auth.slice(6), expected)) return true;
  }
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret || secret.length < 16) return false;
  if (safeEqual(auth, `Bearer ${secret}`)) return true;
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return safeEqual(token, secret);
}

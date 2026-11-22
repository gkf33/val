import { paypalAmount } from "@/domain/money";

/** PayPal.me-Link oder null, wenn PAYPAL_ME_USER nicht gesetzt ist. */
export function paypalMeUrl(amountCents: number): string | null {
  const user = process.env.PAYPAL_ME_USER?.trim();
  if (!user) return null;
  return `https://paypal.me/${encodeURIComponent(user)}/${paypalAmount(amountCents)}EUR`;
}

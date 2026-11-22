import { consumeMagicToken } from "./magicLink";
import { completeLoginFromToken } from "./login";
import { confirmBooking } from "../bookings";

/** Löst einen Magic-Link ein. Gibt Konto + Ziel zurück oder null. */
export async function redeemToken(token: string): Promise<{ accountId: string; redirect: string } | null> {
  const row = await consumeMagicToken(token);
  if (!row) return null;
  if (row.purpose === "login") {
    const r = await completeLoginFromToken(row);
    return { accountId: r.account.id, redirect: r.redirect };
  }
  const r = await confirmBooking(row);
  if (!r) return null;
  const q = r.outcome === "duplicate" ? "?dup=1" : "";
  return { accountId: r.account.id, redirect: `/me${q}` };
}

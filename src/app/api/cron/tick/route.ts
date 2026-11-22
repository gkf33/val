import { NextResponse } from "next/server";
import { safeEqual } from "@/server/crypto";
import { expireOverdue, sendPartyDayReminders, sendPaymentReminders } from "@/server/expiry";

export const dynamic = "force-dynamic";

/**
 * Regelmäßiger Lauf (z. B. alle 5 min über cron-job.org oder Vercel Cron):
 * Fristen ablaufen lassen, Zahlungserinnerungen senden.
 * Auth: Header „Authorization: Bearer <CRON_SECRET>“.
 */
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const expired = await expireOverdue(now);
  const reminders = await sendPaymentReminders(now);
  const partyDay = await sendPartyDayReminders(now);
  return NextResponse.json({ ok: true, expired, reminders, partyDay, at: now.toISOString() });
}

export const GET = handle;
export const POST = handle;

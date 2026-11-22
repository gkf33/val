import { NextResponse } from "next/server";
import { ingestRawEmail } from "@/server/payments/inbound";
import { isAuthorizedWebhook } from "@/server/payments/webhookAuth";

export const dynamic = "force-dynamic";

/** Generischer Eingang: Body = Rohmail (message/rfc822). Für andere Provider und Tests. */
export async function POST(req: Request) {
  if (!isAuthorizedWebhook(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = await req.text();
  if (!raw.trim()) return NextResponse.json({ error: "empty" }, { status: 400 });
  const result = await ingestRawEmail(raw, "raw");
  return NextResponse.json({ ok: true, ...result });
}

import { NextResponse } from "next/server";
import { ingestRawEmail } from "@/server/payments/inbound";
import { isAuthorizedWebhook } from "@/server/payments/webhookAuth";

export const dynamic = "force-dynamic";

/**
 * Postmark Inbound. In Postmark „Include raw email content in JSON payload“ aktivieren,
 * sonst ist keine DKIM-Prüfung möglich und Zahlungen werden nur als Vorschlag angelegt.
 */
export async function POST(req: Request) {
  if (!isAuthorizedWebhook(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json()) as { RawEmail?: string; Subject?: string; HtmlBody?: string; TextBody?: string; From?: string; MessageID?: string; Date?: string };
  let raw = body.RawEmail;
  if (!raw) {
    // Fallback ohne Rohmail: minimal rekonstruieren (DKIM schlägt dann fehl → nur Vorschläge)
    raw = [
      `From: ${body.From ?? ""}`,
      `Subject: ${body.Subject ?? ""}`,
      `Date: ${body.Date ?? new Date().toUTCString()}`,
      `Message-ID: <${body.MessageID ?? crypto.randomUUID()}@postmark.fallback>`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      body.HtmlBody ?? body.TextBody ?? "",
    ].join("\r\n");
  }
  const result = await ingestRawEmail(raw, "postmark");
  // Postmark erwartet 200, sonst wird erneut zugestellt
  return NextResponse.json({ ok: true, status: result.status });
}

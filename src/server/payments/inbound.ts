/**
 * Eingang von PayPal-Mails: speichern, DKIM prüfen, parsen, verbuchen.
 */
import { simpleParser } from "mailparser";
import { parsePaypalMail } from "@/domain/paypalMail";
import { prisma } from "../db";
import { audit, SYSTEM } from "../audit";
import { recordPayment, type RecordOutcome } from "./apply";
import { verifyPaypalDkim } from "./dkim";

export type IngestResult =
  | { status: "duplicate_email"; inboundEmailId: string }
  | { status: "ignored" | "error"; inboundEmailId: string; reason: string }
  | { status: "payment"; inboundEmailId: string; payment: RecordOutcome; dkimValid: boolean };

export async function ingestRawEmail(raw: string, provider: string): Promise<IngestResult> {
  const mail = await simpleParser(raw);
  const messageId = mail.messageId ?? null;
  if (messageId) {
    const dup = await prisma.inboundEmail.findUnique({ where: { messageId } });
    if (dup) return { status: "duplicate_email", inboundEmailId: dup.id };
  }
  const fromAddr = mail.from?.value?.[0]?.address?.toLowerCase() ?? null;
  let dkim = { valid: false, domain: null as string | null };
  try {
    dkim = await verifyPaypalDkim(raw, fromAddr);
  } catch (e) {
    console.error("DKIM-Prüfung fehlgeschlagen", e);
  }

  const email = await prisma.inboundEmail.create({
    data: {
      provider,
      messageId,
      fromAddr,
      subject: mail.subject ?? null,
      raw,
      dkimValid: dkim.valid,
      dkimDomain: dkim.domain,
    },
  });
  return processInbound(email.id);
}

/** Parst eine gespeicherte Mail (erneut) und verbucht die Zahlung. */
export async function processInbound(inboundEmailId: string): Promise<IngestResult> {
  const email = await prisma.inboundEmail.findUniqueOrThrow({ where: { id: inboundEmailId } });
  const mail = await simpleParser(email.raw);
  const parsed = parsePaypalMail({ subject: mail.subject ?? "", html: typeof mail.html === "string" ? mail.html : null, text: mail.text ?? null });

  if (parsed.kind !== "received") {
    await prisma.inboundEmail.update({
      where: { id: email.id },
      data: { kind: parsed.kind, parsedAt: new Date(), parseError: parsed.kind === "error" ? parsed.reason : null },
    });
    await audit(SYSTEM, `inbound.${parsed.kind}`, { entityType: "InboundEmail", entityId: email.id, data: { reason: parsed.reason } });
    return { status: parsed.kind, inboundEmailId: email.id, reason: parsed.reason };
  }

  await prisma.inboundEmail.update({ where: { id: email.id }, data: { kind: "received", parsedAt: new Date(), parseError: null } });
  const payment = await recordPayment({
    paypalTxId: parsed.txId,
    grossCents: parsed.grossCents,
    feeCents: parsed.feeCents,
    currency: parsed.currency,
    senderName: parsed.senderName,
    note: parsed.note,
    paidAt: parsed.paidAt ?? mail.date ?? null,
    source: "email",
    inboundEmailId: email.id,
    trusted: email.dkimValid,
  });
  return { status: "payment", inboundEmailId: email.id, payment, dkimValid: email.dkimValid };
}

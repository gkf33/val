"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import type { Actor } from "@/server/audit";
import {
  assignPayment,
  ignorePayment,
  markBookingPaidManually,
  markPaymentForRefund,
  markRefunded,
  reactivateLatePayment,
  resolveMismatch,
} from "@/server/payments/apply";
import { processInbound } from "@/server/payments/inbound";
import { importPaypalCsv } from "@/server/payments/csvImport";
import { CapacityError } from "@/domain/capacity";

async function actor(): Promise<Actor> {
  const a = await requireAdmin();
  return { type: "admin", label: a.email };
}

function back(tab: string, params: Record<string, string>): never {
  redirect(`/admin/payments?${new URLSearchParams({ tab, ...params }).toString()}`);
}

async function run(tab: string, okText: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    const msg = e instanceof CapacityError ? `Kein Platz frei (${e.free} frei)` : e instanceof Error ? e.message : "Fehler";
    back(tab, { err: msg });
  }
  revalidatePath("/admin");
  back(tab, { ok: okText });
}

export async function assignPaymentAction(paymentId: string, fd: FormData) {
  const a = await actor();
  const code = String(fd.get("ref") ?? "").trim();
  await run("unmatched", "Zahlung zugeordnet", () => assignPayment(a, paymentId, code || undefined));
}

export async function reactivateAction(paymentId: string) {
  const a = await actor();
  await run("unmatched", "Buchung reaktiviert", () => reactivateLatePayment(a, paymentId));
}

export async function refundPaymentAction(paymentId: string) {
  const a = await actor();
  await run("unmatched", "Auf Erstattungsliste", () => markPaymentForRefund(a, paymentId, "Manuell: keine passende Buchung"));
}

export async function ignorePaymentAction(paymentId: string) {
  const a = await actor();
  await run("unmatched", "Ausgeblendet", () => ignorePayment(a, paymentId, "keine Party-Zahlung"));
}

export async function markPaidAction(bookingId: string, fd: FormData) {
  const a = await actor();
  const note = String(fd.get("note") ?? "").trim() || "manuell";
  await run("open", "Als bezahlt markiert", () => markBookingPaidManually(a, bookingId, note));
}

export async function resolveMismatchAction(bookingId: string, decision: "accept" | "refund_difference" | "request_rest") {
  const a = await actor();
  const label = { accept: "Akzeptiert", refund_difference: "Differenz auf Erstattungsliste", request_rest: "Rest angefordert" }[decision];
  await run("mismatch", label, () => resolveMismatch(a, bookingId, decision));
}

export async function markRefundedAction(refundId: string) {
  const a = await actor();
  await run("refunds", "Als erstattet markiert", () => markRefunded(a, refundId));
}

export async function reprocessInboundAction(id: string) {
  await actor();
  await run("inbox", "Neu verarbeitet", () => processInbound(id));
}

export async function csvImportAction(fd: FormData) {
  const a = await actor();
  const file = fd.get("csv");
  if (!(file instanceof File) || file.size === 0) back("import", { err: "Keine Datei" });
  if (file.size > 5_000_000) back("import", { err: "Datei zu groß (max. 5 MB)" });
  const r = await importPaypalCsv(a, await file.text());
  if (r.missingColumns.length) back("import", { err: `Spalten fehlen: ${r.missingColumns.join(", ")}` });
  revalidatePath("/admin");
  back("import", { ok: `${r.rows} Zahlungen gelesen · ${r.duplicates} schon bekannt · ${r.paid} verbucht · ${r.other} zur Prüfung · ${r.skipped} übersprungen` });
}

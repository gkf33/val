import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { expireOverdue } from "@/server/expiry";
import { formatDateTime } from "@/domain/time";
import { formatEuro } from "@/domain/money";
import {
  assignPaymentAction,
  csvImportAction,
  ignorePaymentAction,
  markPaidAction,
  markRefundedAction,
  reactivateAction,
  refundPaymentAction,
  reprocessInboundAction,
  resolveMismatchAction,
} from "@/app/admin/paymentActions";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "Offen" },
  { key: "mismatch", label: "Abweichung" },
  { key: "unmatched", label: "Nicht zugeordnet" },
  { key: "refunds", label: "Erstattung" },
  { key: "paid", label: "Bezahlt" },
  { key: "overdue", label: "Überfällig" },
  { key: "inbox", label: "Eingang" },
  { key: "import", label: "CSV-Import" },
] as const;

const btn = "min-h-11 border border-line-3 px-3 text-sm hover:border-accent";
const btnPrimary = "min-h-11 bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-2";

const bookingInclude = {
  party: { select: { name: true } },
  guests: { select: { name: true, status: true } },
  payments: { where: { state: "matched" as const }, select: { grossCents: true } },
} satisfies Prisma.BookingInclude;

function bookingsWith(status: Prisma.EnumGuestStatusFilter["equals"]) {
  return prisma.booking.findMany({
    where: { guests: { some: { status } } },
    include: bookingInclude,
    orderBy: { paymentDeadline: "asc" },
    take: 200,
  });
}

type B = Awaited<ReturnType<typeof bookingsWith>>[number];
const tz = () => config.timeZone;

function BookingRow({ b, children }: { b: B; children?: React.ReactNode }) {
  const paid = b.payments.reduce((s, p) => s + p.grossCents, 0);
  return (
    <li className="flex flex-col gap-2 border border-line-2 bg-surface p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{b.bookerName}</span>
        <span className="font-mono text-xs text-accent-2">{b.referenceCode}</span>
      </div>
      <p className="text-xs text-fg-2">
        {b.party.name} · {b.guests.filter((g) => g.status !== "rejected" && g.status !== "cancelled").length} P. · fällig{" "}
        <span className="text-fg">{formatEuro(b.lockedAmountCents ?? 0)}</span>
        {paid > 0 && <> · gezahlt <span className="text-fg">{formatEuro(paid)}</span></>}
        {b.paymentDeadline && <> · Frist {formatDateTime(b.paymentDeadline, tz())}</>}
      </p>
      <p className="text-[11px] text-muted">{b.email}</p>
      {children}
    </li>
  );
}

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ tab?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "open";
  await expireOverdue();

  const counts = {
    open: await prisma.booking.count({ where: { guests: { some: { status: "approved_unpaid" } } } }),
    mismatch: await prisma.booking.count({ where: { guests: { some: { status: "payment_mismatch" } } } }),
    unmatched: await prisma.payment.count({ where: { state: { in: ["unmatched", "suggested", "late"] } } }),
    refunds: await prisma.refund.count({ where: { status: "due" } }),
  };

  let content: React.ReactNode = null;

  if (tab === "open" || tab === "paid" || tab === "overdue") {
    const status = tab === "open" ? "approved_unpaid" : tab === "paid" ? "paid" : "expired";
    const list = await bookingsWith(status);
    content = (
      <ul className="flex flex-col gap-2">
        {list.map((b) => (
          <BookingRow key={b.id} b={b}>
            {tab === "open" && (
              <form action={markPaidAction.bind(null, b.id)} className="flex gap-2">
                <label htmlFor={`note-${b.id}`} className="sr-only">Notiz</label>
                <input id={`note-${b.id}`} name="note" placeholder="Notiz, z. B. bar" className="min-h-11 min-w-0 flex-1 border border-line-2 bg-surface-2 px-2 text-sm" />
                <button className={btn}>Bezahlt markieren</button>
              </form>
            )}
          </BookingRow>
        ))}
        {list.length === 0 && <li className="text-sm text-muted">Nichts hier.</li>}
      </ul>
    );
  }

  if (tab === "mismatch") {
    const list = await bookingsWith("payment_mismatch");
    content = (
      <ul className="flex flex-col gap-2">
        {list.map((b) => {
          const paid = b.payments.reduce((s, p) => s + p.grossCents, 0);
          const diff = paid - (b.lockedAmountCents ?? 0);
          return (
            <BookingRow key={b.id} b={b}>
              <p className="text-sm text-warn">▲ {diff > 0 ? `${formatEuro(diff)} zu viel` : `${formatEuro(-diff)} zu wenig`}</p>
              <div className="flex flex-wrap gap-2">
                <form action={resolveMismatchAction.bind(null, b.id, "accept")}>
                  <button className={btnPrimary}>Akzeptieren</button>
                </form>
                {diff > 0 ? (
                  <form action={resolveMismatchAction.bind(null, b.id, "refund_difference")}>
                    <button className={btn}>Differenz erstatten</button>
                  </form>
                ) : (
                  <form action={resolveMismatchAction.bind(null, b.id, "request_rest")}>
                    <button className={btn}>Rest nachfordern</button>
                  </form>
                )}
              </div>
            </BookingRow>
          );
        })}
        {list.length === 0 && <li className="text-sm text-muted">Keine Abweichungen.</li>}
      </ul>
    );
  }

  if (tab === "unmatched") {
    const list = await prisma.payment.findMany({
      where: { state: { in: ["unmatched", "suggested", "late"] } },
      include: { matchedBooking: { include: { party: { select: { name: true } } } }, inboundEmail: { select: { dkimValid: true } } },
      orderBy: { createdAt: "desc" },
    });
    content = (
      <ul className="flex flex-col gap-2">
        {list.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 border border-line-2 bg-surface p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{formatEuro(p.grossCents)}</span>
              <span className="text-xs text-muted">{formatDateTime(p.createdAt, tz())}</span>
            </div>
            <p className="text-xs text-fg-2">
              von {p.senderName ?? "?"} {p.senderEmail && `· ${p.senderEmail}`} · {p.source}
              {p.feeCents ? <span className="text-warn"> · Gebühr {formatEuro(p.feeCents)}</span> : null}
              {p.inboundEmail && !p.inboundEmail.dkimValid && <span className="text-warn"> · DKIM ungültig</span>}
            </p>
            {p.note && <p className="text-xs">Mitteilung: <span className="font-mono">{p.note}</span></p>}
            <p className="font-mono text-[11px] text-muted">{p.paypalTxId}</p>
            {p.state === "suggested" && p.matchedBooking && (
              <div className="flex flex-wrap items-center gap-2 border border-accent-dim p-2 text-sm">
                <span className="flex-1">
                  Vorschlag: {p.matchedBooking.bookerName} · {p.matchedBooking.referenceCode} · {p.matchedBooking.party.name}
                </span>
                <form action={assignPaymentAction.bind(null, p.id)}>
                  <button className={btnPrimary}>Bestätigen</button>
                </form>
              </div>
            )}
            {p.state === "late" && p.matchedBooking && (
              <div className="flex flex-wrap items-center gap-2 border border-warn p-2 text-sm">
                <span className="flex-1">Verspätet: {p.matchedBooking.bookerName} · Platz frei</span>
                <form action={reactivateAction.bind(null, p.id)}>
                  <button className={btnPrimary}>Reaktivieren</button>
                </form>
              </div>
            )}
            <form action={assignPaymentAction.bind(null, p.id)} className="flex gap-2">
              <label htmlFor={`ref-${p.id}`} className="sr-only">Referenzcode</label>
              <input id={`ref-${p.id}`} name="ref" placeholder="Referenzcode" required className="min-h-11 w-36 border border-line-2 bg-surface-2 px-2 font-mono text-sm uppercase" />
              <button className={btn}>Zuordnen</button>
            </form>
            <div className="flex flex-wrap gap-2">
              <form action={refundPaymentAction.bind(null, p.id)}>
                <button className={btn}>Erstattung nötig</button>
              </form>
              <form action={ignorePaymentAction.bind(null, p.id)}>
                <button className="min-h-11 px-2 text-xs text-muted underline">Keine Party-Zahlung</button>
              </form>
            </div>
          </li>
        ))}
        {list.length === 0 && <li className="text-sm text-muted">Alles zugeordnet.</li>}
      </ul>
    );
  }

  if (tab === "refunds") {
    const list = await prisma.refund.findMany({ include: { booking: { select: { referenceCode: true, email: true } } }, orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 200 });
    content = (
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {list.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <span className="w-24 font-semibold">{formatEuro(r.amountCents)}</span>
            <span className="flex-1">
              an {r.recipient}
              <span className="block text-xs text-muted">
                {r.reason}
                {r.booking && ` · ${r.booking.referenceCode} · ${r.booking.email}`}
              </span>
            </span>
            {r.status === "due" ? (
              <form action={markRefundedAction.bind(null, r.id)}>
                <button className={btn}>Erstattet</button>
              </form>
            ) : (
              <span className="text-xs text-ok-2">erstattet {r.refundedAt && formatDateTime(r.refundedAt, tz())}</span>
            )}
          </li>
        ))}
        {list.length === 0 && <li className="py-3 text-sm text-muted">Keine Erstattungen.</li>}
      </ul>
    );
  }

  if (tab === "inbox") {
    const list = await prisma.inboundEmail.findMany({ orderBy: { receivedAt: "desc" }, take: 100, select: { id: true, receivedAt: true, subject: true, fromAddr: true, dkimValid: true, kind: true, parseError: true } });
    content = (
      <ul className="flex flex-col divide-y divide-line border-y border-line">
        {list.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
            <span className="w-32 text-xs text-muted">{formatDateTime(e.receivedAt, tz())}</span>
            <span className="flex-1">
              {e.subject}
              <span className="block text-[11px] text-muted">
                {e.fromAddr} · {e.kind ?? "?"} · DKIM {e.dkimValid ? "✓" : "✗"}
                {e.parseError && <span className="text-warn"> · {e.parseError}</span>}
              </span>
            </span>
            <form action={reprocessInboundAction.bind(null, e.id)}>
              <button className="min-h-11 px-2 text-xs underline">Neu parsen</button>
            </form>
          </li>
        ))}
        {list.length === 0 && <li className="py-3 text-sm text-muted">Noch keine Mails eingegangen.</li>}
      </ul>
    );
  }

  if (tab === "import") {
    content = (
      <form action={csvImportAction} className="flex flex-col gap-3 border border-line p-4">
        <p className="text-sm text-fg-2">
          PayPal → Aktivitäten → Berichte → Kontoauszüge/Aktivitätenexport (CSV). Bereits verbuchte Transaktionen werden erkannt und übersprungen.
        </p>
        <label htmlFor="csv" className="text-xs text-fg-2">CSV-Datei</label>
        <input id="csv" name="csv" type="file" accept=".csv,text/csv" required className="text-sm" />
        <button className={`${btnPrimary} self-start px-5`}>Importieren</button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-lg font-semibold">Zahlungen</h1>
      <nav className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 text-sm">
        {TABS.map((t) => {
          const n = counts[t.key as keyof typeof counts];
          return (
            <Link
              key={t.key}
              href={`/admin/payments?tab=${t.key}`}
              className={`flex min-h-11 shrink-0 items-center px-3 no-underline ${tab === t.key ? "bg-accent text-on-accent" : "border border-line-3 text-fg"}`}
            >
              {t.label}
              {n ? <span className={`ml-1.5 ${tab === t.key ? "" : t.key === "open" ? "text-fg-2" : "text-warn"}`}>{n}</span> : null}
            </Link>
          );
        })}
      </nav>
      {sp.ok && <p className="border border-ok p-3 text-sm text-ok-2">✓ {sp.ok}</p>}
      {sp.err && <p className="border border-warn p-3 text-sm text-warn">▲ {sp.err}</p>}
      {content}
    </div>
  );
}

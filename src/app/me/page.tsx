import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { expireOverdue } from "@/server/expiry";
import { paypalMeUrl } from "@/server/payments/paypal";
import { formatDate, formatDateTime, formatTime } from "@/domain/time";
import { formatEuro } from "@/domain/money";
import { STATUS_LABEL, type GuestStatus } from "@/domain/guestStatus";
import { GhostButton, Prompt } from "@/components/ui";
import { CopyButton } from "@/components/CopyButton";
import { logoutAction } from "../auth/actions";

export const dynamic = "force-dynamic";

const GUEST_LABEL: Partial<Record<GuestStatus, string>> = {
  requested: "angefragt",
  waitlisted: "warteliste",
  approved_unpaid: "freigegeben · zahlung offen",
  payment_mismatch: "betrag prüfen",
  paid: "bezahlt",
  checked_in: "drinnen",
  checked_out: "draußen",
  rejected: "keine freigabe",
  expired: "frist abgelaufen",
  cancelled: "storniert",
  replaced: "ersetzt",
};

function tone(s: GuestStatus): string {
  if (s === "paid" || s === "checked_in" || s === "checked_out") return "text-ok-2";
  if (s === "approved_unpaid" || s === "payment_mismatch") return "text-accent-2";
  if (s === "rejected" || s === "expired" || s === "cancelled") return "text-muted line-through";
  return "text-fg-2";
}

export default async function MePage({ searchParams }: { searchParams: Promise<{ dup?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { dup } = await searchParams;
  await expireOverdue();
  const tz = config.timeZone;
  const bookings = await prisma.booking.findMany({
    where: { accountId: session.account.id },
    include: { party: true, guests: { orderBy: [{ isBooker: "desc" }, { createdAt: "asc" }] } },
    orderBy: { party: { startsAt: "desc" } },
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-7 px-5 py-7">
      <div className="flex items-center justify-between">
        <Prompt>status</Prompt>
        <span className="text-xs text-muted">{session.account.email}</span>
      </div>

      {dup && (
        <p className="border border-warn p-3 text-sm text-warn">
          ▲ Für diese Party gibt es schon eine aktive Anfrage von dir. Die neue wurde verworfen.
        </p>
      )}

      {bookings.length === 0 && <p className="text-sm text-muted">Keine Anfragen.</p>}

      {bookings.map((b) => {
        const unpaid = b.guests.filter((g) => g.status === "approved_unpaid");
        const pay = unpaid.length > 0 && b.lockedAmountCents && b.paymentDeadline;
        const paypal = pay ? paypalMeUrl(b.lockedAmountCents!) : null;
        const visible = b.guests.filter((g) => g.status !== "pending_email");
        return (
          <section key={b.id} className="flex flex-col gap-4 border border-line-2 bg-surface p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-bold">{formatDate(b.party.startsAt, tz)}</h2>
              <span className="text-xs text-muted">
                {formatTime(b.party.startsAt, tz)} – {formatTime(b.party.endsAt, tz)}
              </span>
            </div>

            {!b.confirmedAt ? (
              <p className="text-sm text-warn">E-Mail noch nicht bestätigt. Link in der Mail klicken.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {visible.map((g) => (
                  <li key={g.id} className="flex items-baseline justify-between gap-3 border-b border-line pb-2">
                    <span>{g.name}</span>
                    <span className={`text-right text-xs ${tone(g.status as GuestStatus)}`} title={STATUS_LABEL[g.status as GuestStatus]}>
                      {GUEST_LABEL[g.status as GuestStatus] ?? g.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {pay && (
              <div className="flex flex-col gap-3 border border-accent p-3.5">
                <p className="text-xs text-accent-2">{"// zahlung"}</p>
                <p className="text-sm">
                  Unkostenbeitrag <span className="font-bold">{formatEuro(b.lockedAmountCents!)}</span> bis{" "}
                  <span className="font-bold">{formatDateTime(b.paymentDeadline!, tz)}</span>. Danach verfällt der Platz.
                </p>
                <p className="text-xs text-fg-2">Bitte nur diesen Code als Nachricht angeben:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-2xl font-bold tracking-[0.2em] text-accent-2">{b.referenceCode}</code>
                  <CopyButton value={b.referenceCode} label="kopieren" />
                </div>
                {paypal ? (
                  <a
                    href={paypal}
                    className="flex min-h-[52px] items-center justify-center bg-accent font-bold tracking-wider text-on-accent no-underline"
                  >
                    MIT PAYPAL ZAHLEN ▸
                  </a>
                ) : (
                  <p className="text-xs text-muted">PayPal-Link folgt.</p>
                )}
                <p className="text-xs text-muted">Mit der Zahlung erhältst du deinen QR-Code.</p>
              </div>
            )}

            {b.guests.some((g) => g.status === "paid") && (
              <p className="text-xs text-muted">Bezahlt. QR-Codes erscheinen hier.</p>
            )}
          </section>
        );
      })}

      <form action={logoutAction} className="mt-auto">
        <GhostButton type="submit">abmelden</GhostButton>
      </form>
    </main>
  );
}

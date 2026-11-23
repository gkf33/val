import { redirect } from "next/navigation";
import { getSession } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { config } from "@/server/config";
import { expireOverdue } from "@/server/expiry";
import { paypalMeUrl } from "@/server/payments/paypal";
import { ticketUrl } from "@/server/tickets";
import { partyPathSegment } from "@/domain/codes";
import { canSelfCancel } from "@/domain/deadlines";
import { formatDate, formatDateTime, formatTime } from "@/domain/time";
import { formatEuro } from "@/domain/money";
import { STATUS_LABEL, type GuestStatus } from "@/domain/guestStatus";
import { GhostButton, Prompt } from "@/components/ui";
import { CopyButton } from "@/components/CopyButton";
import { ShareButton } from "@/components/guest/ShareButton";
import { logoutAction } from "../auth/actions";
import { cancelAction, cancelRequestAction, deleteAccountAction, nameChangeAction } from "./actions";

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

const CANCELLABLE = ["requested", "waitlisted", "approved_unpaid", "payment_mismatch", "paid"];
const VALID = ["paid", "checked_in", "checked_out"];
const input = "w-full rounded-[2px] border border-line-2 bg-surface-2 px-3 py-2.5 text-sm text-fg outline-none focus:border-accent";

function tone(s: GuestStatus): string {
  if (s === "paid" || s === "checked_in" || s === "checked_out") return "text-ok-2";
  if (s === "approved_unpaid" || s === "payment_mismatch") return "text-accent-2";
  if (s === "rejected" || s === "expired" || s === "cancelled" || s === "replaced") return "text-muted line-through";
  return "text-fg-2";
}

export default async function MePage({ searchParams }: { searchParams: Promise<{ dup?: string; ok?: string; err?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const sp = await searchParams;
  await expireOverdue();
  const tz = config.timeZone;
  const now = new Date();
  const bookings = await prisma.booking.findMany({
    where: { accountId: session.account.id },
    include: {
      party: { include: { links: { where: { active: true, type: "public" }, take: 1 } } },
      guests: { orderBy: [{ isBooker: "desc" }, { createdAt: "asc" }], include: { nameChanges: { where: { status: "pending" } } } },
    },
    orderBy: { party: { startsAt: "desc" } },
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-7 px-5 py-7">
      <div className="flex items-center justify-between">
        <Prompt>status</Prompt>
        <span className="text-xs text-muted">{session.account.email}</span>
      </div>

      {sp.dup && (
        <p className="border border-warn p-3 text-sm text-warn">▲ Für diese Party gibt es schon eine aktive Anfrage von dir. Die neue wurde verworfen.</p>
      )}
      {sp.ok && <p className="border border-ok p-3 text-sm text-ok-2">✓ {sp.ok}</p>}
      {sp.err && <p className="border border-warn p-3 text-sm text-warn">▲ {sp.err}</p>}

      {bookings.length === 0 && <p className="text-sm text-muted">Keine Anfragen.</p>}

      {bookings.map((b) => {
        const unpaid = b.guests.filter((g) => g.status === "approved_unpaid");
        const pay = unpaid.length > 0 && b.lockedAmountCents && b.paymentDeadline;
        const paypal = pay ? paypalMeUrl(b.lockedAmountCents!) : null;
        const visible = b.guests.filter((g) => g.status !== "pending_email");
        const tickets = b.guests.filter((g) => g.ticketToken && VALID.includes(g.status));
        const cancellable = b.guests.filter((g) => CANCELLABLE.includes(g.status));
        const future = b.party.startsAt > now;
        const selfCancel = canSelfCancel(b.party, now, config.rules.selfCancelHours);
        const publicLink = b.party.links[0];
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
                      {g.nameChanges.length > 0 && <span className="block text-warn">änderung beantragt</span>}
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
                <ol className="flex list-decimal flex-col gap-1 pl-4 text-xs text-fg-2">
                  <li>
                    Genau <span className="font-bold text-fg">{formatEuro(b.lockedAmountCents!)}</span> senden.
                  </li>
                  <li>
                    <span className="font-bold text-fg">„Freunde &amp; Familie“</span> wählen.
                  </li>
                  <li>Diesen Code als Mitteilung angeben:</li>
                </ol>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-2xl font-bold tracking-[0.2em] text-accent-2">{b.referenceCode}</code>
                  <CopyButton value={b.referenceCode} label="kopieren" />
                </div>
                {paypal ? (
                  <a href={paypal} className="flex min-h-[52px] items-center justify-center bg-accent font-bold tracking-wider text-on-accent no-underline">
                    MIT PAYPAL ZAHLEN ▸
                  </a>
                ) : (
                  <p className="text-xs text-muted">PayPal-Link folgt.</p>
                )}
                <p className="text-xs text-muted">Mit der Zahlung erhältst du deinen QR-Code.</p>
              </div>
            )}

            {b.guests.some((g) => g.status === "payment_mismatch") && (
              <p className="border border-warn p-3 text-xs text-warn">
                ▲ Betrag weicht ab. Wir prüfen und melden uns. Code für Nachzahlungen: <span className="font-mono">{b.referenceCode}</span>
              </p>
            )}

            {tickets.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-accent-2">{"// qr-codes"}</p>
                {tickets.map((g) => {
                  const url = ticketUrl(g.ticketToken!);
                  return (
                    <div key={g.id} className="flex items-center gap-2">
                      <a href={url} className="flex min-h-11 flex-1 items-center border border-accent px-3 text-sm text-fg no-underline">
                        {g.name} ▸
                      </a>
                      {!g.isBooker && <ShareButton url={url} name={g.name} />}
                    </div>
                  );
                })}
                <p className="text-[11px] text-muted">Begleitungen: Link weiterleiten. Jeder Code gilt nur für die genannte Person.</p>
              </div>
            )}

            {future && b.confirmedAt && tickets.some((g) => g.status === "paid" && g.nameChanges.length === 0) && (
              <details className="text-sm">
                <summary className="min-h-11 cursor-pointer py-3 text-fg-2">Name ändern (Ersatzperson)</summary>
                <div className="flex flex-col gap-4">
                  {tickets
                    .filter((g) => g.status === "paid" && g.nameChanges.length === 0)
                    .map((g) => (
                      <form key={g.id} action={nameChangeAction.bind(null, g.id)} className="flex flex-col gap-2 border border-line p-3">
                        <p className="text-xs text-muted">Statt {g.name}:</p>
                        <label htmlFor={`nc-name-${g.id}`} className="text-xs text-fg-2">Name — wie im Ausweis</label>
                        <input id={`nc-name-${g.id}`} name="name" required className={input} />
                        <label htmlFor={`nc-mail-${g.id}`} className="text-xs text-fg-2">E-Mail (optional)</label>
                        <input id={`nc-mail-${g.id}`} name="email" type="email" className={input} />
                        <label htmlFor={`nc-g-${g.id}`} className="text-xs text-fg-2">Geschlecht</label>
                        <select id={`nc-g-${g.id}`} name="gender" required defaultValue="" className={input}>
                          <option value="" disabled>
                            m / w / d
                          </option>
                          <option value="m">m</option>
                          <option value="w">w</option>
                          <option value="d">d</option>
                        </select>
                        <label className="flex min-h-11 items-center gap-3 text-sm">
                          <input type="checkbox" name="adult" className="size-5" /> 18+ bestätigt
                        </label>
                        <button className="min-h-11 border border-line-3 text-sm hover:border-accent">Änderung beantragen</button>
                        <p className="text-[11px] text-muted">Nach Freigabe wird der alte QR-Code ungültig.</p>
                      </form>
                    ))}
                </div>
              </details>
            )}

            {future && b.confirmedAt && cancellable.length > 0 &&
              (selfCancel ? (
                <details className="text-sm">
                  <summary className="min-h-11 cursor-pointer py-3 text-fg-2">Stornieren</summary>
                  <form action={cancelAction.bind(null, b.id)} className="flex flex-col gap-1">
                    {cancellable.map((g) => (
                      <label key={g.id} className="flex min-h-11 items-center gap-3">
                        <input type="checkbox" name="guest" value={g.id} className="size-5" /> {g.name}
                      </label>
                    ))}
                    <p className="text-[11px] text-muted">
                      Möglich bis {config.rules.selfCancelHours} h vor Beginn. Bereits Gezahltes wird erstattet.
                    </p>
                    <button className="mt-2 min-h-11 border border-warn text-sm text-warn">Auswahl stornieren</button>
                  </form>
                </details>
              ) : (
                <details className="text-sm">
                  <summary className="min-h-11 cursor-pointer py-3 text-fg-2">Storno anfragen</summary>
                  <form action={cancelRequestAction.bind(null, b.id)} className="flex flex-col gap-2">
                    <p className="text-xs text-muted">Die Storno-Frist ist vorbei. Wir entscheiden im Einzelfall.</p>
                    <label htmlFor={`cr-${b.id}`} className="text-xs text-fg-2">Nachricht</label>
                    <textarea id={`cr-${b.id}`} name="message" rows={2} className={input} />
                    <button className="min-h-11 border border-line-3 text-sm">Anfrage senden</button>
                  </form>
                </details>
              ))}

            {b.party.transparencyPublic && publicLink && (
              <a href={`/p/${partyPathSegment(b.party.slug, publicLink.code)}/transparenz`} className="text-xs">
                transparenz: einnahmen vs. kosten ▸
              </a>
            )}
          </section>
        );
      })}

      <div className="mt-auto flex flex-col gap-3 border-t border-line pt-5">
        <form action={logoutAction}>
          <GhostButton type="submit">abmelden</GhostButton>
        </form>
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-3 text-muted">Konto löschen</summary>
          <form action={deleteAccountAction} className="flex flex-col gap-2">
            <p className="text-xs text-muted">Löscht Konto, Namen und Historie. Kommende Anfragen vorher stornieren.</p>
            <label htmlFor="confirm" className="text-xs text-fg-2">Zum Bestätigen LÖSCHEN eintippen</label>
            <input id="confirm" name="confirm" autoComplete="off" className={input} />
            <button className="min-h-11 border border-bad text-sm text-bad">Endgültig löschen</button>
          </form>
        </details>
      </div>
    </main>
  );
}

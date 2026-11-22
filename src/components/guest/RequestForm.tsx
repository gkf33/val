"use client";

import { useActionState, useState } from "react";
import type { RequestFormState } from "@/app/p/[segment]/actions";

interface Companion {
  name: string;
  email: string;
  adult: boolean;
}

const input =
  "w-full rounded-[2px] border border-line-2 bg-surface-2 px-3 py-3 text-[15px] text-fg outline-none placeholder:text-faint focus:border-accent";

function Err({ msg }: { msg?: string }) {
  return msg ? <p className="text-xs text-warn">▲ {msg}</p> : null;
}

export function RequestForm({
  action,
  maxGroupSize,
  feeLabel,
  deadlineLabel,
  prefill,
  knownCompanions,
}: {
  action: (prev: RequestFormState, fd: FormData) => Promise<RequestFormState>;
  maxGroupSize: number;
  feeLabel: string;
  deadlineLabel: string;
  prefill?: { name: string; email: string };
  knownCompanions: { name: string; email: string | null }[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  // Kontrollierte Felder: React 19 setzt unkontrollierte Felder nach jeder Action zurück.
  const [name, setName] = useState(prefill?.name ?? "");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [adult, setAdult] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [notAttending, setNotAttending] = useState(false);
  const [companions, setCompanions] = useState<Companion[]>([]);
  const e = state.errors ?? {};
  const maxCompanions = maxGroupSize - (notAttending ? 0 : 1);
  const canAdd = companions.length < maxCompanions;

  const update = (i: number, patch: Partial<Companion>) =>
    setCompanions((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const add = (c?: Partial<Companion>) => canAdd && setCompanions((cs) => [...cs, { name: "", email: "", adult: false, ...c }]);
  const unused = knownCompanions.filter((k) => !companions.some((c) => c.name === k.name));

  return (
    <form action={formAction} className="flex flex-col gap-[18px]" noValidate>
      <p className="text-[13px] text-muted">{"// anfrage"}</p>
      <input type="hidden" name="companions" value={JSON.stringify(companions)} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="r-name" className="text-xs text-fg-2">Name — wie im Ausweis</label>
        <input id="r-name" name="name" autoComplete="name" value={name} onChange={(ev) => setName(ev.target.value)} className={input} required />
        <Err msg={e.name} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="r-mail" className="text-xs text-fg-2">E-Mail</label>
        <input id="r-mail" name="email" type="email" autoComplete="email" placeholder="du@domain.de" value={email} onChange={(ev) => setEmail(ev.target.value)} className={input} required />
        <Err msg={e.email} />
      </div>

      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="adult" checked={adult} onChange={(ev) => setAdult(ev.target.checked)} className="size-5 shrink-0" />
        Ich bin 18 oder älter.
      </label>
      <Err msg={e.adult} />
      <label className="flex min-h-11 items-center gap-3 text-sm text-fg-2">
        <input
          type="checkbox"
          name="notAttending"
          className="size-5 shrink-0"
          checked={notAttending}
          onChange={(ev) => setNotAttending(ev.target.checked)}
        />
        Ich komme nicht selbst, buche nur für andere.
      </label>

      {companions.map((c, i) => (
        <div key={i} className="flex flex-col gap-3 border border-line p-3.5">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>+1 · begleitung</span>
            <button
              type="button"
              className="min-h-11 px-2 text-muted hover:text-fg"
              aria-label={`Begleitung ${i + 1} entfernen`}
              onClick={() => setCompanions((cs) => cs.filter((_, j) => j !== i))}
            >
              entfernen ✕
            </button>
          </div>
          <label htmlFor={`c${i}-name`} className="text-xs text-fg-2">Name — wie im Ausweis</label>
          <input id={`c${i}-name`} value={c.name} onChange={(ev) => update(i, { name: ev.target.value })} className={input} />
          <Err msg={e[`c${i}.name`]} />
          <label htmlFor={`c${i}-mail`} className="text-xs text-fg-2">E-Mail (optional)</label>
          <input id={`c${i}-mail`} type="email" value={c.email} placeholder="—" onChange={(ev) => update(i, { email: ev.target.value })} className={input} />
          <Err msg={e[`c${i}.email`]} />
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input type="checkbox" checked={c.adult} onChange={(ev) => update(i, { adult: ev.target.checked })} className="size-5 shrink-0" />
            18+ bestätigt
          </label>
          <Err msg={e[`c${i}.adult`]} />
        </div>
      ))}

      {canAdd && (
        <button type="button" onClick={() => add()} className="min-h-11 border border-dashed border-line-3 text-sm text-fg-2 hover:border-accent">
          + person hinzufügen <span className="text-muted">({companions.length}/{maxCompanions})</span>
        </button>
      )}
      {canAdd && unused.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="w-full text-muted">frühere begleitung:</span>
          {unused.map((k) => (
            <button
              key={k.name}
              type="button"
              onClick={() => add({ name: k.name, email: k.email ?? "" })}
              className="min-h-9 border border-line-2 px-2.5 text-fg-2 hover:border-accent"
            >
              + {k.name}
            </button>
          ))}
        </div>
      )}
      <Err msg={e.group} />

      <div className="flex flex-col gap-2.5 border border-[#3a3466] bg-[#0e0c1a] p-3.5">
        <p className="text-xs text-accent-2">{"// ablauf"}</p>
        <ol className="grid grid-cols-4 gap-1.5 text-center text-[11px]">
          <li className="border-t-2 border-accent pt-1.5">01<br />anfrage</li>
          <li className="border-t-2 border-line-3 pt-1.5 text-fg-2">02<br />freigabe</li>
          <li className="border-t-2 border-line-3 pt-1.5 text-fg-2">03<br />zahlung</li>
          <li className="border-t-2 border-line-3 pt-1.5 text-fg-2">04<br />qr-code</li>
        </ol>
        <p className="text-[13px] leading-relaxed">
          Absenden ist noch kein Einlass. Nach der Freigabe zahlst du einen{" "}
          <span className="text-accent">Unkostenbeitrag von {feeLabel} pro Person</span> per PayPal, innerhalb von {deadlineLabel}. Danach
          verfällt der Platz. Mit der Zahlung erhältst du deinen QR-Code.
        </p>
      </div>

      <label className="flex items-start gap-3 text-[11px] leading-relaxed text-muted">
        <input type="checkbox" name="privacy" checked={privacy} onChange={(ev) => setPrivacy(ev.target.checked)} className="mt-0.5 size-5 shrink-0" />
        <span>
          Wir speichern nur Namen, E-Mail und 18+-Bestätigung, um die Gästeliste zu führen. Gelöscht 30 Tage nach der Party. Dein Konto bleibt,
          bis du es löschst. Verstanden.
        </span>
      </label>
      <Err msg={e.privacy} />
      <Err msg={e.form} />

      <button
        type="submit"
        disabled={pending}
        className="min-h-[52px] bg-accent text-[15px] font-bold tracking-wider text-on-accent hover:bg-accent-2 disabled:opacity-50"
      >
        {pending ? "SENDET …" : "ANFRAGE SENDEN ▸"}
      </button>
    </form>
  );
}

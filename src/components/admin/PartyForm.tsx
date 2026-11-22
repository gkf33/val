"use client";

import { useActionState } from "react";
import { Field, Input, Textarea } from "@/components/ui";
import type { FormState } from "@/app/admin/actions";

export interface PartyFormValues {
  name: string;
  status: "draft" | "open" | "closed";
  startsAt: string;
  endsAt: string;
  registrationClosesAt: string;
  paymentsAcceptedUntil: string;
  paymentDeadlineMinutes: number;
  capacity: number;
  fee: string;
  maxGroupSize: number;
  city: string;
  address: string;
  directions: string;
  info: string;
  transparencyPublic: boolean;
}

const sans = "font-sans";

export function PartyForm({
  action,
  initial,
  submitLabel,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  initial: PartyFormValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const e = state.errors ?? {};
  return (
    <form action={formAction} className="flex flex-col gap-6">
      <section className="grid gap-4 sm:grid-cols-2">
        <Field id="name" label="Name (intern)" error={e.name}>
          <Input id="name" name="name" defaultValue={initial.name} required className={sans} />
        </Field>
        <Field id="status" label="Status" error={e.status} hint="Entwurf: Link zeigt 404. Geschlossen: keine neuen Anfragen.">
          <select
            id="status"
            name="status"
            defaultValue={initial.status}
            className="min-h-[50px] w-full rounded-[2px] border border-line-2 bg-surface-2 px-3 text-[15px] text-fg"
          >
            <option value="draft">Entwurf</option>
            <option value="open">Offen</option>
            <option value="closed">Geschlossen</option>
          </select>
        </Field>
      </section>

      <fieldset className="grid gap-4 border border-line p-4 sm:grid-cols-2">
        <legend className="px-1 text-xs text-muted">Zeiten (Europe/Berlin)</legend>
        <Field id="startsAt" label="Beginn" error={e.startsAt}>
          <Input id="startsAt" name="startsAt" type="datetime-local" defaultValue={initial.startsAt} required className={sans} />
        </Field>
        <Field id="endsAt" label="Ende" error={e.endsAt}>
          <Input id="endsAt" name="endsAt" type="datetime-local" defaultValue={initial.endsAt} required className={sans} />
        </Field>
        <Field id="registrationClosesAt" label="Anmeldeschluss" error={e.registrationClosesAt} hint="Leer = bis Beginn">
          <Input id="registrationClosesAt" name="registrationClosesAt" type="datetime-local" defaultValue={initial.registrationClosesAt} className={sans} />
        </Field>
        <Field id="paymentsAcceptedUntil" label="Zahlungen akzeptiert bis" error={e.paymentsAcceptedUntil} hint="Leer = 24 h vor Beginn">
          <Input id="paymentsAcceptedUntil" name="paymentsAcceptedUntil" type="datetime-local" defaultValue={initial.paymentsAcceptedUntil} className={sans} />
        </Field>
        <Field id="paymentDeadlineMinutes" label="Zahlungsfrist nach Freigabe (Minuten)" error={e.paymentDeadlineMinutes}>
          <Input id="paymentDeadlineMinutes" name="paymentDeadlineMinutes" type="number" min={5} defaultValue={initial.paymentDeadlineMinutes} required className={sans} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border border-line p-4 sm:grid-cols-3">
        <legend className="px-1 text-xs text-muted">Plätze &amp; Beitrag</legend>
        <Field id="capacity" label="Kapazität (inkl. Crew)" error={e.capacity}>
          <Input id="capacity" name="capacity" type="number" min={1} defaultValue={initial.capacity} required className={sans} />
        </Field>
        <Field id="fee" label="Unkostenbeitrag p. P. (€)" error={e.fee}>
          <Input id="fee" name="fee" inputMode="decimal" defaultValue={initial.fee} required className={sans} />
        </Field>
        <Field id="maxGroupSize" label="Max. Gruppe (inkl. Bucher)" error={e.maxGroupSize}>
          <Input id="maxGroupSize" name="maxGroupSize" type="number" min={1} defaultValue={initial.maxGroupSize} required className={sans} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 border border-line p-4">
        <legend className="px-1 text-xs text-muted">Ort &amp; Infos</legend>
        <Field id="city" label="Stadt (öffentlich sichtbar)" error={e.city}>
          <Input id="city" name="city" defaultValue={initial.city} className={sans} />
        </Field>
        <Field id="address" label="Adresse (nur auf dem QR-Code)" error={e.address}>
          <Input id="address" name="address" defaultValue={initial.address} className={sans} />
        </Field>
        <Field id="directions" label="Anfahrt (nur auf dem QR-Code)" error={e.directions}>
          <Textarea id="directions" name="directions" rows={3} defaultValue={initial.directions} className={sans} />
        </Field>
        <Field id="info" label="Info auf der Party-Seite" error={e.info}>
          <Textarea id="info" name="info" rows={3} defaultValue={initial.info} className={sans} />
        </Field>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" name="transparencyPublic" defaultChecked={initial.transparencyPublic} className="size-5" />
          Transparenzseite für Gäste sichtbar
        </label>
      </fieldset>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="min-h-12 bg-accent px-6 text-sm font-semibold text-on-accent hover:bg-accent-2 disabled:opacity-50"
        >
          {pending ? "Speichert …" : submitLabel}
        </button>
        {state.ok && <span className="text-sm text-ok-2">Gespeichert ✓</span>}
        {state.errors && <span className="text-sm text-warn">Bitte Felder prüfen.</span>}
      </div>
    </form>
  );
}

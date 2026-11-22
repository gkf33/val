/**
 * Statusmaschine für Gäste. Einzige Quelle der Wahrheit für erlaubte Übergänge.
 * Jede Statusänderung in der App läuft über `assertTransition`.
 */

export const GUEST_STATUSES = [
  "pending_email",
  "requested",
  "waitlisted",
  "rejected",
  "approved_unpaid",
  "payment_mismatch",
  "paid",
  "checked_in",
  "checked_out",
  "expired",
  "cancelled",
  "replaced",
] as const;

export type GuestStatus = (typeof GUEST_STATUSES)[number];

const TRANSITIONS: Record<GuestStatus, readonly GuestStatus[]> = {
  pending_email: ["requested", "waitlisted", "cancelled"],
  requested: ["approved_unpaid", "rejected", "waitlisted", "cancelled"],
  waitlisted: ["requested", "approved_unpaid", "rejected", "cancelled"],
  rejected: [],
  approved_unpaid: ["paid", "expired", "cancelled", "payment_mismatch"],
  payment_mismatch: ["paid", "cancelled", "expired"],
  paid: ["checked_in", "cancelled", "replaced"],
  checked_in: ["checked_out"],
  checked_out: ["checked_in"],
  // Reaktivierung durch Admin nach verspäteter Zahlung (nur mit freiem Platz)
  expired: ["approved_unpaid", "paid"],
  cancelled: [],
  replaced: [],
};

/** Status, die einen Platz belegen (Kapazität). */
export const OCCUPYING_STATUSES: readonly GuestStatus[] = [
  "approved_unpaid",
  "payment_mismatch",
  "paid",
  "checked_in",
  "checked_out",
];

/** Übergänge, die einen zusätzlichen Platz brauchen. */
export function needsSeat(from: GuestStatus, to: GuestStatus): boolean {
  return !OCCUPYING_STATUSES.includes(from) && OCCUPYING_STATUSES.includes(to);
}

export function occupiesSeat(status: GuestStatus): boolean {
  return OCCUPYING_STATUSES.includes(status);
}

export function canTransition(from: GuestStatus, to: GuestStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class TransitionError extends Error {
  constructor(
    public readonly from: GuestStatus,
    public readonly to: GuestStatus,
  ) {
    super(`Ungültiger Statuswechsel: ${from} → ${to}`);
    this.name = "TransitionError";
  }
}

export function assertTransition(from: GuestStatus, to: GuestStatus): void {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

export function allowedTransitions(from: GuestStatus): readonly GuestStatus[] {
  return TRANSITIONS[from];
}

/** Kurze deutsche Labels für UI. */
export const STATUS_LABEL: Record<GuestStatus, string> = {
  pending_email: "E-Mail offen",
  requested: "Angefragt",
  waitlisted: "Warteliste",
  rejected: "Abgelehnt",
  approved_unpaid: "Freigegeben, unbezahlt",
  payment_mismatch: "Betrag abweichend",
  paid: "Bezahlt",
  checked_in: "Drinnen",
  checked_out: "Draußen",
  expired: "Frist abgelaufen",
  cancelled: "Storniert",
  replaced: "Ersetzt",
};

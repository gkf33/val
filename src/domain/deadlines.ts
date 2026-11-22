/**
 * Fristen. Alle Funktionen sind rein und bekommen „jetzt“ als Parameter.
 */

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

export interface PartyTimes {
  startsAt: Date;
  endsAt: Date;
  registrationClosesAt?: Date | null;
  paymentsAcceptedUntil?: Date | null;
  paymentDeadlineMinutes: number;
}

/** Bis wann Zahlungen akzeptiert werden (Party-Einstellung oder Beginn − Cutoff). */
export function paymentsAcceptedUntil(party: PartyTimes, cutoffHours: number): Date {
  return party.paymentsAcceptedUntil ?? new Date(party.startsAt.getTime() - cutoffHours * HOUR);
}

/**
 * Zahlungsfrist = min(Freigabe + Frist, Zahlungen akzeptiert bis).
 * Gibt null zurück, wenn zum Freigabezeitpunkt keine Zahlung mehr möglich ist.
 */
export function computePaymentDeadline(
  approvedAt: Date,
  party: PartyTimes,
  cutoffHours: number,
): Date | null {
  const byDuration = approvedAt.getTime() + party.paymentDeadlineMinutes * MINUTE;
  const hardLimit = paymentsAcceptedUntil(party, cutoffHours).getTime();
  if (hardLimit <= approvedAt.getTime()) return null;
  return new Date(Math.min(byDuration, hardLimit));
}

export function isDeadlinePassed(deadline: Date | null | undefined, now: Date): boolean {
  return !!deadline && now.getTime() > deadline.getTime();
}

/** Zeitpunkt der Zahlungserinnerung (nur wenn vor der Frist). */
export function reminderDueAt(approvedAt: Date, deadline: Date, reminderMinutes: number): Date | null {
  const at = approvedAt.getTime() + reminderMinutes * MINUTE;
  return at < deadline.getTime() ? new Date(at) : null;
}

export function isRegistrationOpen(party: PartyTimes, now: Date): boolean {
  const closes = party.registrationClosesAt ?? party.startsAt;
  return now.getTime() < closes.getTime();
}

export function canMoveUpFromWaitlist(party: PartyTimes, now: Date, cutoffHours: number): boolean {
  return now.getTime() < party.startsAt.getTime() - cutoffHours * HOUR;
}

export function canSelfCancel(party: PartyTimes, now: Date, selfCancelHours: number): boolean {
  return now.getTime() < party.startsAt.getTime() - selfCancelHours * HOUR;
}

/** Door-Zugang: ab Beginn − fromHours bis Ende + 6 h. */
export function doorWindow(party: PartyTimes, fromHoursBeforeStart = 2, hoursAfterEnd = 6) {
  return {
    from: new Date(party.startsAt.getTime() - fromHoursBeforeStart * HOUR),
    to: new Date(party.endsAt.getTime() + hoursAfterEnd * HOUR),
  };
}

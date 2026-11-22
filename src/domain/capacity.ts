/**
 * Kapazitätsregeln (rein, ohne DB). Die DB-Seite mit Locking liegt in
 * src/server/capacity.ts und nutzt diese Funktionen.
 *
 * Belegt = Gäste in OCCUPYING_STATUSES (inkl. Crew).
 */

export interface CapacitySnapshot {
  capacity: number;
  occupied: number;
}

export function freeSeats({ capacity, occupied }: CapacitySnapshot): number {
  return Math.max(0, capacity - occupied);
}

export function fitsInCapacity(snapshot: CapacitySnapshot, additional: number): boolean {
  if (additional < 0) throw new Error("additional darf nicht negativ sein");
  return snapshot.occupied + additional <= snapshot.capacity;
}

export class CapacityError extends Error {
  constructor(
    public readonly requested: number,
    public readonly free: number,
  ) {
    super(`Nicht genug Plätze: ${requested} angefragt, ${free} frei`);
    this.name = "CapacityError";
  }
}

export function assertFits(snapshot: CapacitySnapshot, additional: number): void {
  if (!fitsInCapacity(snapshot, additional)) {
    throw new CapacityError(additional, freeSeats(snapshot));
  }
}

/** Grobe Stufe für Gäste-Anzeige, falls genaue Zahl ausgeblendet werden soll. */
export function availabilityLevel(snapshot: CapacitySnapshot): "frei" | "fast voll" | "ausgebucht" {
  const free = freeSeats(snapshot);
  if (free === 0) return "ausgebucht";
  if (free <= Math.max(5, Math.round(snapshot.capacity * 0.1))) return "fast voll";
  return "frei";
}

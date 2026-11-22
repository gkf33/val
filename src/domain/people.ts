/**
 * Personen: Namensnormalisierung, Duplikat- und Sperrlisten-Abgleich, Anfragevalidierung.
 */

export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Vor- und Nachname, wie im Ausweis: mindestens zwei Wörter. */
export function isFullName(name: string): boolean {
  const parts = name.trim().split(/\s+/).filter((p) => p.length >= 1);
  return parts.length >= 2 && name.trim().length >= 4 && name.trim().length <= 80;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function isEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim()) && s.length <= 200;
}

export interface PersonRef {
  name: string;
  email?: string | null;
}

export interface MatchHit<T> {
  person: PersonRef;
  match: T;
  by: "name" | "email";
}

/** Findet Treffer von `people` in `against` über normalisierten Namen oder E-Mail. */
export function findMatches<T extends PersonRef>(people: PersonRef[], against: T[]): MatchHit<T>[] {
  const hits: MatchHit<T>[] = [];
  for (const p of people) {
    const n = normalizeName(p.name);
    const e = p.email ? normalizeEmail(p.email) : null;
    for (const a of against) {
      if (e && a.email && normalizeEmail(a.email) === e) hits.push({ person: p, match: a, by: "email" });
      else if (n && a.name && normalizeName(a.name) === n) hits.push({ person: p, match: a, by: "name" });
    }
  }
  return hits;
}

// ── Anfrage ───────────────────────────────────────────────

export interface RequestInput {
  name: string;
  email: string;
  adult: boolean;
  notAttending: boolean;
  companions: { name: string; email?: string; adult: boolean }[];
  privacy: boolean;
}

export interface ValidRequest {
  bookerName: string;
  email: string;
  bookerAttends: boolean;
  guests: { name: string; email: string | null; isBooker: boolean }[];
}

export type RequestErrors = Record<string, string>;

export function validateRequest(
  input: RequestInput,
  maxGroupSize: number,
): { ok: true; value: ValidRequest } | { ok: false; errors: RequestErrors } {
  const errors: RequestErrors = {};
  const name = input.name.trim().replace(/\s+/g, " ");
  const email = normalizeEmail(input.email);
  if (!isFullName(name)) errors.name = "Vor- und Nachname, wie im Ausweis";
  if (!isEmail(email)) errors.email = "E-Mail ungültig";
  if (!input.adult) errors.adult = "Nur ab 18";
  if (!input.privacy) errors.privacy = "Bitte bestätigen";

  const companions = input.companions.map((c) => ({
    name: c.name.trim().replace(/\s+/g, " "),
    email: c.email?.trim() ? normalizeEmail(c.email) : null,
    adult: c.adult,
  }));
  companions.forEach((c, i) => {
    if (!isFullName(c.name)) errors[`c${i}.name`] = "Vor- und Nachname, wie im Ausweis";
    if (c.email && !isEmail(c.email)) errors[`c${i}.email`] = "E-Mail ungültig";
    if (!c.adult) errors[`c${i}.adult`] = "Nur ab 18";
  });

  const attendees = (input.notAttending ? 0 : 1) + companions.length;
  if (attendees === 0) errors.group = "Mindestens eine Person hinzufügen";
  if (attendees > maxGroupSize) errors.group = `Maximal ${maxGroupSize} Personen pro Anfrage`;

  const names = [...(input.notAttending ? [] : [name]), ...companions.map((c) => c.name)].map(normalizeName);
  if (new Set(names).size !== names.length) errors.group = "Doppelte Namen in der Anfrage";

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      bookerName: name,
      email,
      bookerAttends: !input.notAttending,
      guests: [
        ...(input.notAttending ? [] : [{ name, email, isBooker: true }]),
        ...companions.map((c) => ({ name: c.name, email: c.email, isBooker: false })),
      ],
    },
  };
}

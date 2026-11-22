/**
 * Referenz- und Link-Codes. Ohne verwechselbare Zeichen (0/O, 1/I/L).
 */
import { randomInt } from "node:crypto";

export const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LINK_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomString(alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** Referenzcode für Buchungen, z. B. „7KQ-M4X“. */
export function generateReferenceCode(): string {
  const raw = randomString(REFERENCE_ALPHABET, 6);
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

/** Normalisiert Nutzereingaben: Großschreibung, ohne Leerzeichen/Bindestriche. */
export function normalizeReferenceCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidReferenceCode(input: string): boolean {
  const n = normalizeReferenceCode(input);
  return n.length === 6 && [...n].every((c) => REFERENCE_ALPHABET.includes(c));
}

export function generateLinkCode(length = 8): string {
  return randomString(LINK_ALPHABET, length);
}

/** Slug aus Partyname: Kleinbuchstaben, Umlaute ersetzt, Bindestriche. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "party"
  );
}

/** Party-Pfadsegment `<slug>-<code>`. */
export function partyPathSegment(slug: string, code: string): string {
  return `${slug}-${code}`;
}

/** Zerlegt `<slug>-<code>`; der Code ist das letzte Segment. */
export function parsePartyPathSegment(segment: string): { slug: string; code: string } | null {
  const i = segment.lastIndexOf("-");
  if (i <= 0 || i === segment.length - 1) return null;
  const slug = segment.slice(0, i);
  const code = segment.slice(i + 1).toLowerCase();
  if (![...code].every((c) => LINK_ALPHABET.includes(c))) return null;
  return { slug, code };
}

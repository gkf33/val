import { z } from "zod";
import type { LinkType, PartyStatus } from "@prisma/client";
import { generateLinkCode, parsePartyPathSegment, partyPathSegment, slugify } from "@/domain/codes";
import { localInputToUtc } from "@/domain/time";
import { parseEuroToCents } from "@/domain/money";
import { prisma } from "./db";
import { audit, type Actor } from "./audit";
import { config } from "./config";

const optionalLocal = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v : undefined));

export const partyFormSchema = z.object({
  name: z.string().trim().min(1, "Name fehlt").max(80),
  status: z.enum(["draft", "open", "closed"]),
  startsAt: z.string().min(1, "Beginn fehlt"),
  endsAt: z.string().min(1, "Ende fehlt"),
  registrationClosesAt: optionalLocal,
  paymentsAcceptedUntil: optionalLocal,
  paymentDeadlineMinutes: z.coerce.number().int().min(5).max(60 * 24 * 14),
  capacity: z.coerce.number().int().min(1).max(5000),
  fee: z.string().min(1, "Beitrag fehlt"),
  maxGroupSize: z.coerce.number().int().min(1).max(20),
  city: z.string().trim().max(80).optional(),
  address: z.string().trim().max(300).optional(),
  directions: z.string().trim().max(2000).optional(),
  info: z.string().trim().max(2000).optional(),
  transparencyPublic: z.string().optional().transform((v) => v === "on" || v === "true"),
});

export type PartyFormInput = z.input<typeof partyFormSchema>;

export class FormError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super(Object.values(fieldErrors).join(", "));
    this.name = "FormError";
  }
}

/** Validiert Formulardaten und wandelt lokale Zeiten in UTC. */
export function parsePartyForm(raw: Record<string, unknown>) {
  const parsed = partyFormSchema.safeParse(raw);
  if (!parsed.success) {
    const errs: Record<string, string> = {};
    for (const i of parsed.error.issues) errs[String(i.path[0])] = i.message;
    throw new FormError(errs);
  }
  const v = parsed.data;
  const tz = config.timeZone;
  const errs: Record<string, string> = {};
  const startsAt = localInputToUtc(v.startsAt, tz);
  const endsAt = localInputToUtc(v.endsAt, tz);
  const registrationClosesAt = v.registrationClosesAt ? localInputToUtc(v.registrationClosesAt, tz) : null;
  const paymentsAcceptedUntil = v.paymentsAcceptedUntil ? localInputToUtc(v.paymentsAcceptedUntil, tz) : null;
  const feeCents = parseEuroToCents(v.fee);
  if (!startsAt) errs.startsAt = "Ungültiges Datum";
  if (!endsAt) errs.endsAt = "Ungültiges Datum";
  if (startsAt && endsAt && endsAt <= startsAt) errs.endsAt = "Ende muss nach Beginn liegen";
  if (startsAt && registrationClosesAt && registrationClosesAt > startsAt)
    errs.registrationClosesAt = "Anmeldeschluss muss vor Beginn liegen";
  if (startsAt && paymentsAcceptedUntil && paymentsAcceptedUntil > startsAt)
    errs.paymentsAcceptedUntil = "Muss vor Beginn liegen";
  if (feeCents === null) errs.fee = "Betrag ungültig (z. B. 20 oder 12,50)";
  if (Object.keys(errs).length) throw new FormError(errs);

  return {
    name: v.name,
    status: v.status as PartyStatus,
    startsAt: startsAt!,
    endsAt: endsAt!,
    registrationClosesAt,
    paymentsAcceptedUntil,
    paymentDeadlineMinutes: v.paymentDeadlineMinutes,
    capacity: v.capacity,
    feeCents: feeCents!,
    maxGroupSize: v.maxGroupSize,
    city: v.city || null,
    address: v.address || null,
    directions: v.directions || null,
    info: v.info || null,
    transparencyPublic: v.transparencyPublic,
  };
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let i = 2; await prisma.party.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;
  return slug;
}

export async function createParty(actor: Actor, raw: Record<string, unknown>) {
  const data = parsePartyForm(raw);
  const party = await prisma.party.create({ data: { ...data, slug: await uniqueSlug(data.name) } });
  // Jede Party bekommt direkt einen öffentlichen Link.
  await createPartyLink(actor, party.id, "public");
  await audit(actor, "party.create", { entityType: "Party", entityId: party.id, partyId: party.id, data: { name: party.name } });
  return party;
}

export async function updateParty(actor: Actor, partyId: string, raw: Record<string, unknown>) {
  const data = parsePartyForm(raw);
  const before = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
  const party = await prisma.$transaction(async (tx) => {
    // Kapazität darf nicht unter die aktuelle Belegung sinken.
    if (data.capacity < before.capacity) {
      const { occupiedSeats } = await import("./capacity");
      const occ = await occupiedSeats(tx, partyId);
      if (data.capacity < occ) throw new FormError({ capacity: `Bereits ${occ} Plätze belegt` });
    }
    return tx.party.update({ where: { id: partyId }, data });
  });
  const changed = Object.keys(data).filter(
    (k) => String(before[k as keyof typeof before]) !== String(data[k as keyof typeof data]),
  );
  await audit(actor, "party.update", { entityType: "Party", entityId: partyId, partyId, data: { changed } });
  return party;
}

// ── Links ────────────────────────────────────────────────

export async function createPartyLink(actor: Actor, partyId: string, type: Exclude<LinkType, "door">, inviterLabel?: string) {
  if (type === "inviter" && !inviterLabel?.trim()) throw new FormError({ inviterLabel: "Name des Einladers fehlt" });
  const link = await prisma.partyLink.create({
    data: { partyId, type, code: generateLinkCode(), inviterLabel: inviterLabel?.trim() || null },
  });
  await audit(actor, "link.create", { entityType: "PartyLink", entityId: link.id, partyId, data: { type, inviterLabel: link.inviterLabel } });
  return link;
}

export async function deactivateLink(actor: Actor, linkId: string) {
  const link = await prisma.partyLink.update({ where: { id: linkId }, data: { active: false, deactivatedAt: new Date() } });
  await audit(actor, "link.deactivate", { entityType: "PartyLink", entityId: link.id, partyId: link.partyId });
  return link;
}

/** Deaktiviert den Link und erzeugt einen neuen gleichen Typs. */
export async function regenerateLink(actor: Actor, linkId: string) {
  const old = await prisma.partyLink.findUniqueOrThrow({ where: { id: linkId } });
  if (old.type === "door") throw new Error("Door-Links werden separat verwaltet");
  await deactivateLink(actor, linkId);
  return createPartyLink(actor, old.partyId, old.type, old.inviterLabel ?? undefined);
}

export function partyUrl(slug: string, code: string): string {
  return `${config.appUrl}/p/${partyPathSegment(slug, code)}`;
}

/** Löst einen Gäste-Link auf. Nur aktive public/inviter-Links offener Partys. */
export async function resolvePartyLink(segment: string) {
  const parsed = parsePartyPathSegment(segment);
  if (!parsed) return null;
  const link = await prisma.partyLink.findUnique({ where: { code: parsed.code }, include: { party: true } });
  if (!link || !link.active || link.type === "door") return null;
  if (link.party.slug !== parsed.slug) return null;
  if (link.party.status === "draft") return null;
  return link;
}

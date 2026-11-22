/**
 * Einlass: Door-Links mit PIN, Geräte, Scan, Check-in/-out, Offline-Sync.
 * Türsteher haben keine Accounts; ein Gerät wird per PIN registriert und
 * bekommt ein Cookie, das nur für diesen Door-Link gilt.
 */
import { cookies } from "next/headers";
import type { GuestStatus } from "@prisma/client";
import { doorWindow } from "@/domain/deadlines";
import { generateLinkCode } from "@/domain/codes";
import { normalizeName } from "@/domain/people";
import { prisma } from "./db";
import { audit, type Actor } from "./audit";
import { hashPin, randomToken, sha256, verifyPin } from "./crypto";
import { ticketHash, verifyTicketPayload } from "./tickets";

export class DoorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DoorError";
  }
}

const PIN_RE = /^\d{4,8}$/;
const MAX_PIN_FAILS = 10;
const cookieName = (code: string) => `gl_door_${code}`;

// ── Admin ─────────────────────────────────────────────────

export async function createDoorLink(actor: Actor, partyId: string, pin: string) {
  if (!PIN_RE.test(pin)) throw new DoorError("PIN: 4–8 Ziffern");
  const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
  const w = doorWindow(party);
  const link = await prisma.partyLink.create({
    data: { partyId, type: "door", code: generateLinkCode(10), pinHash: hashPin(pin), validFrom: w.from, validTo: w.to },
  });
  await audit(actor, "door.link.create", { entityType: "PartyLink", entityId: link.id, partyId });
  return link;
}

export async function revokeDoorLink(actor: Actor, linkId: string) {
  const link = await prisma.partyLink.update({ where: { id: linkId }, data: { active: false, deactivatedAt: new Date() } });
  await prisma.doorDevice.updateMany({ where: { linkId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(actor, "door.link.revoke", { entityType: "PartyLink", entityId: linkId, partyId: link.partyId });
}

export async function revokeDevice(actor: Actor, deviceId: string) {
  const d = await prisma.doorDevice.update({ where: { id: deviceId }, data: { revokedAt: new Date(), offlinePrimary: false } });
  await audit(actor, "door.device.revoke", { entityType: "DoorDevice", entityId: deviceId, partyId: d.partyId, data: { name: d.name } });
}

/** Genau ein Gerät pro Party darf offline einchecken. */
export async function setOfflinePrimary(actor: Actor, deviceId: string) {
  const d = await prisma.doorDevice.findUniqueOrThrow({ where: { id: deviceId } });
  if (d.revokedAt) throw new DoorError("Gerät ist gesperrt");
  await prisma.$transaction([
    prisma.doorDevice.updateMany({ where: { partyId: d.partyId }, data: { offlinePrimary: false } }),
    prisma.doorDevice.update({ where: { id: deviceId }, data: { offlinePrimary: true } }),
  ]);
  await audit(actor, "door.device.offline_primary", { entityType: "DoorDevice", entityId: deviceId, partyId: d.partyId, data: { name: d.name } });
}

// ── Gerät ─────────────────────────────────────────────────

function linkUsable(link: { active: boolean; validFrom: Date | null; validTo: Date | null }, now = new Date()) {
  if (!link.active) return "Door-Link widerrufen";
  if (link.validFrom && now < link.validFrom) return "Noch nicht gültig";
  if (link.validTo && now > link.validTo) return "Abgelaufen";
  return null;
}

export async function getDoorLink(code: string) {
  return prisma.partyLink.findFirst({ where: { code, type: "door" }, include: { party: true } });
}

export async function registerDevice(code: string, pin: string, name: string) {
  const link = await getDoorLink(code);
  if (!link || !link.pinHash) throw new DoorError("Unbekannter Link");
  const problem = linkUsable(link);
  if (problem) throw new DoorError(problem);
  const since = new Date(Date.now() - 15 * 60_000);
  const fails = await prisma.auditLog.count({ where: { action: "door.pin_fail", entityId: link.id, createdAt: { gte: since } } });
  if (fails >= MAX_PIN_FAILS) throw new DoorError("Zu viele Fehlversuche. 15 Minuten warten.");
  if (!verifyPin(pin, link.pinHash)) {
    await audit({ type: "door", label: name || "?" }, "door.pin_fail", { entityType: "PartyLink", entityId: link.id, partyId: link.partyId });
    throw new DoorError("PIN falsch");
  }
  const deviceName = name.trim().slice(0, 40) || "Scanner";
  const token = randomToken();
  const device = await prisma.doorDevice.create({
    data: { partyId: link.partyId, linkId: link.id, name: deviceName, tokenHash: sha256(token), lastSeenAt: new Date() },
  });
  const jar = await cookies();
  jar.set(cookieName(code), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: link.validTo ?? new Date(Date.now() + 86_400_000),
  });
  await audit({ type: "door", label: deviceName }, "door.device.register", { entityType: "DoorDevice", entityId: device.id, partyId: link.partyId });
  return device;
}

export type DoorDevice = NonNullable<Awaited<ReturnType<typeof getDevice>>>;

/** Gerät aus dem Cookie; null, wenn nicht registriert, gesperrt oder Link ungültig. */
export async function getDevice(code: string) {
  const jar = await cookies();
  const token = jar.get(cookieName(code))?.value;
  if (!token) return null;
  const device = await prisma.doorDevice.findUnique({ where: { tokenHash: sha256(token) }, include: { link: true, party: true } });
  if (!device || device.revokedAt || device.link.code !== code || linkUsable(device.link)) return null;
  if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000) {
    await prisma.doorDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  }
  return device;
}

const actorOf = (d: DoorDevice): Actor => ({ type: "door", label: d.name });

// ── Scan ──────────────────────────────────────────────────

export interface ScanResult {
  ok: boolean;
  reason: "valid" | "reentry" | "inside" | "unpaid" | "cancelled" | "wrong_party" | "unknown" | "blocked" | "invalid_code";
  message: string;
  guest?: { id: string; name: string; crew: boolean; role: string | null; status: GuestStatus; via: string | null; group: string | null };
  checkedInAt?: string | null;
  checkedInDevice?: string | null;
}

async function blocked(name: string, email: string | null): Promise<boolean> {
  const list = await prisma.blocklist.findMany();
  const n = normalizeName(name);
  return list.some((b) => (b.name && normalizeName(b.name) === n) || (email && b.email && b.email.toLowerCase() === email.toLowerCase()));
}

async function describe(device: DoorDevice, guestId: string): Promise<ScanResult> {
  const g = await prisma.guest.findUnique({
    where: { id: guestId },
    include: { booking: { include: { viaLink: true, guests: { select: { id: true, status: true } } } } },
  });
  if (!g) return { ok: false, reason: "unknown", message: "Unbekannt" };
  if (g.partyId !== device.partyId) return { ok: false, reason: "wrong_party", message: "Falsche Party" };
  const active = g.booking?.guests.filter((x) => ["paid", "checked_in", "checked_out"].includes(x.status)) ?? [];
  const guest = {
    id: g.id,
    name: g.name,
    crew: g.type === "crew",
    role: g.role,
    status: g.status,
    via: g.booking?.viaLink?.type === "inviter" ? g.booking.viaLink.inviterLabel : null,
    group: active.length > 1 ? `${active.findIndex((x) => x.id === g.id) + 1} / ${active.length}` : null,
  };
  const at = { checkedInAt: g.checkedInAt?.toISOString() ?? null, checkedInDevice: g.checkedInDevice };
  if (await blocked(g.name, g.email)) return { ok: false, reason: "blocked", message: "Gesperrt", guest, ...at };
  switch (g.status) {
    case "paid":
      return { ok: true, reason: "valid", message: g.type === "crew" ? "Crew" : "Gültig · bezahlt", guest };
    case "checked_out":
      return { ok: true, reason: "reentry", message: "Wiedereinlass", guest, ...at };
    case "checked_in":
      return { ok: false, reason: "inside", message: "Bereits eingecheckt", guest, ...at };
    case "approved_unpaid":
    case "payment_mismatch":
      return { ok: false, reason: "unpaid", message: "Nicht bezahlt", guest };
    default:
      return { ok: false, reason: "cancelled", message: "Storniert / ungültig", guest };
  }
}

export async function scan(device: DoorDevice, payload: string): Promise<ScanResult> {
  const token = verifyTicketPayload(payload);
  if (!token) return { ok: false, reason: "invalid_code", message: "Kein gültiger Code" };
  const g = await prisma.guest.findUnique({ where: { ticketToken: token }, select: { id: true } });
  if (!g) return { ok: false, reason: "unknown", message: "Unbekannt" };
  return describe(device, g.id);
}

export async function lookupGuest(device: DoorDevice, guestId: string) {
  return describe(device, guestId);
}

/** Atomarer Check-in: nur aus paid oder checked_out. */
export async function checkIn(device: DoorDevice, guestId: string, at = new Date()): Promise<ScanResult> {
  const res = await prisma.guest.updateMany({
    where: { id: guestId, partyId: device.partyId, status: { in: ["paid", "checked_out"] } },
    data: { status: "checked_in", checkedInAt: at, checkedInDevice: device.name, statusChangedAt: at },
  });
  const result = await describe(device, guestId);
  if (res.count !== 1) return { ...result, ok: false };
  await audit(actorOf(device), "door.checkin", { entityType: "Guest", entityId: guestId, partyId: device.partyId });
  return { ...result, ok: true, message: "Eingecheckt" };
}

export async function checkOut(device: DoorDevice, guestId: string, at = new Date()): Promise<ScanResult> {
  const res = await prisma.guest.updateMany({
    where: { id: guestId, partyId: device.partyId, status: "checked_in" },
    data: { status: "checked_out", checkedOutAt: at, statusChangedAt: at },
  });
  const result = await describe(device, guestId);
  if (res.count !== 1) return { ...result, ok: false };
  await audit(actorOf(device), "door.checkout", { entityType: "Guest", entityId: guestId, partyId: device.partyId });
  return { ...result, ok: true, message: "Ausgecheckt" };
}

export async function search(device: DoorDevice, q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  const guests = await prisma.guest.findMany({
    where: { partyId: device.partyId, status: { in: ["paid", "checked_in", "checked_out", "approved_unpaid"] }, name: { contains: term, mode: "insensitive" } },
    select: { id: true, name: true, status: true, type: true },
    orderBy: { name: "asc" },
    take: 20,
  });
  return guests;
}

export async function doorStats(partyId: string) {
  const [party, inside, everIn, expected] = await Promise.all([
    prisma.party.findUniqueOrThrow({ where: { id: partyId }, select: { capacity: true, endsAt: true } }),
    prisma.guest.count({ where: { partyId, status: "checked_in" } }),
    prisma.guest.count({ where: { partyId, status: { in: ["checked_in", "checked_out"] } } }),
    prisma.guest.count({ where: { partyId, status: "paid" } }),
  ]);
  const over = party.endsAt < new Date();
  return { inside, capacity: party.capacity, checkedInTotal: everIn, expected: over ? 0 : expected, noShows: over ? expected : 0 };
}

/** Offline-Cache: gültige Tickets dieser Party (Token nur als Hash). */
export async function manifest(device: DoorDevice) {
  const guests = await prisma.guest.findMany({
    where: { partyId: device.partyId, status: { in: ["paid", "checked_in", "checked_out"] }, ticketToken: { not: null } },
    select: { id: true, name: true, status: true, type: true, role: true, ticketToken: true },
  });
  return {
    generatedAt: new Date().toISOString(),
    offlinePrimary: device.offlinePrimary,
    guests: guests.map((g) => ({ id: g.id, h: ticketHash(g.ticketToken!), n: g.name, s: g.status, c: g.type === "crew", r: g.role })),
  };
}

export interface SyncOp {
  guestId: string;
  op: "in" | "out";
  at: string;
}

/** Offline erfasste Aktionen nachträglich buchen. Nur für das Offline-Primärgerät. */
export async function syncOffline(device: DoorDevice, ops: SyncOp[]) {
  if (!device.offlinePrimary) throw new DoorError("Gerät ist nicht offline-berechtigt");
  const results: { guestId: string; ok: boolean; message: string }[] = [];
  for (const o of ops.slice(0, 500)) {
    const at = new Date(o.at);
    const when = Number.isFinite(at.getTime()) && at <= new Date() ? at : new Date();
    const r = o.op === "in" ? await checkIn(device, o.guestId, when) : await checkOut(device, o.guestId, when);
    results.push({ guestId: o.guestId, ok: r.ok, message: r.message });
  }
  await audit(actorOf(device), "door.sync", { partyId: device.partyId, data: { ops: ops.length, failed: results.filter((r) => !r.ok).length } });
  return results;
}

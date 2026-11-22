import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// next/headers: Cookie-Speicher für Gerät simulieren
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => jar.set(k, v),
    delete: (k: string) => jar.delete(k),
  }),
}));

import { prisma } from "@/server/db";
import { MemoryMailer, setMailer } from "@/server/mail/mailer";
import {
  checkIn,
  checkOut,
  createDoorLink,
  doorStats,
  getDevice,
  manifest,
  registerDevice,
  revokeDevice,
  scan,
  search,
  setOfflinePrimary,
  syncOffline,
  DoorError,
} from "@/server/door";
import { signTicket, ticketHash, ticketUrl, verifyTicketPayload } from "@/server/tickets";
import { addCrew } from "@/server/approval";
import { withPartyLock, transitionGuests } from "@/server/capacity";
import { makeBooking, makeParty } from "./helpers";

const admin = { type: "admin" as const, label: "admin" };
beforeAll(() => setMailer(new MemoryMailer()));
afterAll(() => prisma.$disconnect());

async function setup() {
  const party = await makeParty(10);
  // Door-Fenster um „jetzt“ legen
  await prisma.party.update({ where: { id: party.id }, data: { startsAt: new Date(Date.now() + 3_600_000), endsAt: new Date(Date.now() + 8 * 3_600_000) } });
  const link = await createDoorLink(admin, party.id, "4711");
  jar.clear();
  const device = await registerDevice(link.code, "4711", "Scanner 1");
  const d = (await getDevice(link.code))!;
  const b = await makeBooking(party.id, 2, "approved_unpaid");
  await withPartyLock(party.id, (tx) => transitionGuests(tx, party.id, b.guests.map((g) => g.id), "paid"));
  const guests = await prisma.guest.findMany({ where: { bookingId: b.id } });
  return { party, link, device, d, guests };
}

describe("QR-Codes", () => {
  it("Tokens bei Zahlung, signiert, ohne Klartext", async () => {
    const { guests } = await setup();
    for (const g of guests) expect(g.ticketToken).toBeTruthy();
    const t = guests[0].ticketToken!;
    expect(verifyTicketPayload(signTicket(t))).toBe(t);
    expect(verifyTicketPayload(ticketUrl(t))).toBe(t);
    expect(verifyTicketPayload(`${t}.AAAAAAAAAAAAAAAA`)).toBeNull();
    expect(signTicket(t)).not.toContain(guests[0].name);
  });
});

describe("Door-Zugang", () => {
  it("falsche PIN, Sperre nach 10 Fehlversuchen", async () => {
    const party = await makeParty(10);
    await prisma.party.update({ where: { id: party.id }, data: { startsAt: new Date(Date.now() + 3_600_000), endsAt: new Date(Date.now() + 8 * 3_600_000) } });
    const link = await createDoorLink(admin, party.id, "123456");
    await expect(registerDevice(link.code, "000000", "X")).rejects.toThrow("PIN falsch");
    for (let i = 0; i < 9; i++) await registerDevice(link.code, "000000", "X").catch(() => {});
    await expect(registerDevice(link.code, "123456", "X")).rejects.toThrow(/Fehlversuche/);
  });

  it("außerhalb des Zeitfensters ungültig", async () => {
    const party = await makeParty(10); // Beginn in 10 Tagen
    const link = await createDoorLink(admin, party.id, "4711");
    await expect(registerDevice(link.code, "4711", "X")).rejects.toThrow("Noch nicht gültig");
  });

  it("gesperrtes Gerät verliert den Zugang", async () => {
    const { link, device } = await setup();
    expect(await getDevice(link.code)).not.toBeNull();
    await revokeDevice(admin, device.id);
    expect(await getDevice(link.code)).toBeNull();
  });

  it("PIN muss 4–8 Ziffern haben", async () => {
    const party = await makeParty(10);
    await expect(createDoorLink(admin, party.id, "12a")).rejects.toBeInstanceOf(DoorError);
  });
});

describe("Scan und Check-in", () => {
  it("gültig → einchecken → zweiter Scan rot → auschecken → Wiedereinlass", async () => {
    const { d, guests, party } = await setup();
    const payload = ticketUrl(guests[0].ticketToken!);
    const r1 = await scan(d, payload);
    expect(r1).toMatchObject({ ok: true, reason: "valid", guest: { name: guests[0].name, group: "1 / 2" } });

    expect((await checkIn(d, guests[0].id)).ok).toBe(true);
    const r2 = await scan(d, payload);
    expect(r2).toMatchObject({ ok: false, reason: "inside", checkedInDevice: "Scanner 1" });
    expect((await checkIn(d, guests[0].id)).ok).toBe(false); // kein doppelter Einlass
    expect((await doorStats(party.id)).inside).toBe(1);

    expect((await checkOut(d, guests[0].id)).ok).toBe(true);
    expect((await scan(d, payload)).reason).toBe("reentry");
    expect((await doorStats(party.id)).inside).toBe(0);
    expect((await checkIn(d, guests[0].id)).ok).toBe(true);
    expect(await doorStats(party.id)).toMatchObject({ inside: 1, checkedInTotal: 1, expected: 1 });
  });

  it("gleichzeitiger Check-in auf zwei Geräten gelingt nur einmal", async () => {
    const { d, guests } = await setup();
    const results = await Promise.all([checkIn(d, guests[1].id), checkIn(d, guests[1].id), checkIn(d, guests[1].id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("falsche Party, unbezahlt, storniert, ungültiger Code", async () => {
    const a = await setup();
    const b = await setup();
    expect((await scan(a.d, ticketUrl(b.guests[0].ticketToken!))).reason).toBe("wrong_party");
    expect((await scan(a.d, "https://x/t/abc.def")).reason).toBe("invalid_code");

    const unpaid = await makeBooking(a.party.id, 1, "approved_unpaid");
    await prisma.guest.update({ where: { id: unpaid.guests[0].id }, data: { ticketToken: "unbezahltes-token-123456" } });
    expect((await scan(a.d, signTicket("unbezahltes-token-123456"))).reason).toBe("unpaid");

    await prisma.guest.update({ where: { id: a.guests[1].id }, data: { status: "cancelled" } });
    expect((await scan(a.d, signTicket(a.guests[1].ticketToken!))).reason).toBe("cancelled");
  });

  it("Sperrliste schlägt an", async () => {
    const { d, guests } = await setup();
    await prisma.blocklist.create({ data: { name: guests[0].name } });
    expect((await scan(d, signTicket(guests[0].ticketToken!))).reason).toBe("blocked");
    await prisma.blocklist.deleteMany({ where: { name: guests[0].name } });
  });

  it("Crew bekommt QR-Code und Badge", async () => {
    const { d, party } = await setup();
    const crew = await addCrew(admin, party.id, { name: "DJ Nord", role: "DJ" });
    const r = await scan(d, signTicket(crew.ticketToken!));
    expect(r).toMatchObject({ ok: true, guest: { crew: true, role: "DJ" } });
  });

  it("Namenssuche", async () => {
    const { d, guests } = await setup();
    const hits = await search(d, guests[0].name.slice(0, 4).toLowerCase());
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("Offline", () => {
  it("Manifest enthält nur Hashes gültiger Tickets", async () => {
    const { d, guests } = await setup();
    const m = await manifest(d);
    expect(m.guests).toHaveLength(2);
    expect(m.guests[0].h).toBe(ticketHash(guests.find((g) => g.id === m.guests[0].id)!.ticketToken!));
    expect(JSON.stringify(m)).not.toContain(guests[0].ticketToken!);
  });

  it("Sync nur vom Offline-Hauptgerät", async () => {
    const { d, device, guests, link } = await setup();
    await expect(syncOffline(d, [{ guestId: guests[0].id, op: "in", at: new Date().toISOString() }])).rejects.toBeInstanceOf(DoorError);
    await setOfflinePrimary(admin, device.id);
    const d2 = (await getDevice(link.code))!;
    const r = await syncOffline(d2, [
      { guestId: guests[0].id, op: "in", at: new Date(Date.now() - 60_000).toISOString() },
      { guestId: guests[0].id, op: "in", at: new Date().toISOString() }, // doppelt → abgelehnt
    ]);
    expect(r.map((x) => x.ok)).toEqual([true, false]);
  });
});

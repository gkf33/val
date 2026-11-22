import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { createPartyLink, deactivateLink, regenerateLink, resolvePartyLink } from "@/server/parties";
import { partyPathSegment } from "@/domain/codes";
import { makeParty } from "./helpers";

const actor = { type: "admin" as const, label: "test" };
afterAll(() => prisma.$disconnect());

describe("Party-Links", () => {
  it("löst aktive Links offener Partys auf", async () => {
    const party = await makeParty(10);
    const link = await createPartyLink(actor, party.id, "public");
    const resolved = await resolvePartyLink(partyPathSegment(party.slug, link.code));
    expect(resolved?.party.id).toBe(party.id);
  });

  it("falscher Slug, Entwurf oder deaktiviert → null", async () => {
    const party = await makeParty(10);
    const link = await createPartyLink(actor, party.id, "public");
    expect(await resolvePartyLink(partyPathSegment("anders", link.code))).toBeNull();

    await prisma.party.update({ where: { id: party.id }, data: { status: "draft" } });
    expect(await resolvePartyLink(partyPathSegment(party.slug, link.code))).toBeNull();
    await prisma.party.update({ where: { id: party.id }, data: { status: "open" } });

    await deactivateLink(actor, link.id);
    expect(await resolvePartyLink(partyPathSegment(party.slug, link.code))).toBeNull();
  });

  it("Neu erzeugen deaktiviert den alten Link und behält den Einlader", async () => {
    const party = await makeParty(10);
    const old = await createPartyLink(actor, party.id, "inviter", "Jonas");
    const fresh = await regenerateLink(actor, old.id);
    expect(fresh.code).not.toBe(old.code);
    expect(fresh.inviterLabel).toBe("Jonas");
    expect((await prisma.partyLink.findUnique({ where: { id: old.id } }))?.active).toBe(false);
    expect((await resolvePartyLink(partyPathSegment(party.slug, fresh.code)))?.inviterLabel).toBe("Jonas");
  });

  it("Einlader-Link ohne Namen ist ungültig", async () => {
    const party = await makeParty(10);
    await expect(createPartyLink(actor, party.id, "inviter", " ")).rejects.toThrow();
  });
});

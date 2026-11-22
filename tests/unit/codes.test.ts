import { describe, expect, it } from "vitest";
import {
  REFERENCE_ALPHABET,
  generateLinkCode,
  generateReferenceCode,
  isValidReferenceCode,
  normalizeReferenceCode,
  parsePartyPathSegment,
  partyPathSegment,
  slugify,
} from "@/domain/codes";
import { formatEuro, parseEuroToCents, paypalAmount } from "@/domain/money";

describe("Codes", () => {
  it("Referenzcode ohne verwechselbare Zeichen", () => {
    for (let i = 0; i < 500; i++) {
      const c = generateReferenceCode();
      expect(c).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
      expect(c).not.toMatch(/[01OIL]/);
      expect(isValidReferenceCode(c)).toBe(true);
    }
    expect(REFERENCE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("normalisiert tolerant", () => {
    expect(normalizeReferenceCode(" 7kq m4x ")).toBe("7KQM4X");
    expect(normalizeReferenceCode("7kq-m4x")).toBe("7KQM4X");
    expect(isValidReferenceCode("7kq m4x")).toBe(true);
    expect(isValidReferenceCode("7KQ-M40")).toBe(false);
  });

  it("Party-Pfad hin und zurück", () => {
    const code = generateLinkCode();
    const seg = partyPathSegment("nacht-07", code);
    expect(parsePartyPathSegment(seg)).toEqual({ slug: "nacht-07", code });
    expect(parsePartyPathSegment("ohnecode")).toBeNull();
    expect(parsePartyPathSegment("x-0000")).toBeNull();
  });

  it("slugify", () => {
    expect(slugify("Nacht 07 – Über Größe!")).toBe("nacht-07-ueber-groesse");
    expect(slugify("!!!")).toBe("party");
  });
});

describe("Geld", () => {
  it("parst und formatiert", () => {
    expect(parseEuroToCents("12,50")).toBe(1250);
    expect(parseEuroToCents("20")).toBe(2000);
    expect(parseEuroToCents("20,555")).toBeNull();
    expect(formatEuro(1250)).toMatch(/12,50/);
    expect(paypalAmount(2500)).toBe("25");
    expect(paypalAmount(2550)).toBe("25.50");
  });
});

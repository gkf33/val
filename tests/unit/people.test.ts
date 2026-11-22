import { describe, expect, it } from "vitest";
import { findMatches, isFullName, normalizeName, validateRequest, type RequestInput } from "@/domain/people";

const base: RequestInput = {
  name: "Alex Beispiel",
  email: "Alex@Example.com ",
  adult: true,
  notAttending: false,
  companions: [],
  privacy: true,
};

describe("Namen", () => {
  it("normalisiert Umlaute, Akzente, Leerzeichen", () => {
    expect(normalizeName("  Jürgen   Groß-Müller ")).toBe("jurgen gross muller");
    expect(normalizeName("José Núñez")).toBe("jose nunez");
  });
  it("verlangt Vor- und Nachnamen", () => {
    expect(isFullName("Alex")).toBe(false);
    expect(isFullName("Alex B")).toBe(true);
  });
  it("findet Treffer über Name oder E-Mail", () => {
    const hits = findMatches(
      [{ name: "Max Ärger", email: "x@y.de" }, { name: "Neu Person", email: "BAD@y.de" }],
      [{ name: "max arger" }, { name: "", email: "bad@y.de" }],
    );
    expect(hits.map((h) => h.by)).toEqual(["name", "email"]);
  });
});

describe("Anfrage-Validierung", () => {
  it("einfacher Fall", () => {
    const r = validateRequest(base, 5);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.email).toBe("alex@example.com");
      expect(r.value.guests).toEqual([{ name: "Alex Beispiel", email: "alex@example.com", isBooker: true }]);
    }
  });

  it("18+, Datenschutz und Name sind Pflicht", () => {
    const r = validateRequest({ ...base, name: "Alex", adult: false, privacy: false }, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["adult", "name", "privacy"]);
  });

  it("Gruppengröße inkl. Bucher", () => {
    const companions = Array.from({ length: 5 }, (_, i) => ({ name: `Gast Nummer${"abcde"[i]}`, adult: true }));
    expect(validateRequest({ ...base, companions }, 5).ok).toBe(false);
    expect(validateRequest({ ...base, companions: companions.slice(0, 4) }, 5).ok).toBe(true);
    expect(validateRequest({ ...base, notAttending: true, companions }, 5).ok).toBe(true);
  });

  it("nur für andere buchen braucht mindestens eine Person", () => {
    const r = validateRequest({ ...base, notAttending: true }, 5);
    expect(r.ok).toBe(false);
    const ok = validateRequest({ ...base, notAttending: true, companions: [{ name: "Sam Muster", adult: true }] }, 5);
    expect(ok.ok && ok.value.guests).toEqual([{ name: "Sam Muster", email: null, isBooker: false }]);
  });

  it("Begleitung braucht 18+ und gültige optionale E-Mail", () => {
    const r = validateRequest({ ...base, companions: [{ name: "Sam Muster", email: "kaputt", adult: false }] }, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["c0.adult", "c0.email"]);
  });

  it("doppelte Namen in einer Anfrage", () => {
    const r = validateRequest({ ...base, companions: [{ name: "alex  beispiel", adult: true }] }, 5);
    expect(r.ok).toBe(false);
  });
});

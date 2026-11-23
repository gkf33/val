import { describe, expect, it } from "vitest";
import { countGenders, findMatches, isFullName, normalizeName, validateRequest, type RequestInput } from "@/domain/people";

const base: RequestInput = {
  name: "Alex Beispiel",
  email: "Alex@Example.com ",
  gender: "w",
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
      expect(r.value.guests).toEqual([{ name: "Alex Beispiel", email: "alex@example.com", isBooker: true, gender: "w" }]);
    }
  });

  it("18+, Datenschutz, Name und Geschlecht sind Pflicht", () => {
    const r = validateRequest({ ...base, name: "Alex", gender: "x", adult: false, privacy: false }, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["adult", "gender", "name", "privacy"]);
  });

  it("Geschlecht des Buchers nur nötig, wenn er selbst kommt", () => {
    const r = validateRequest({ ...base, gender: undefined, notAttending: true, companions: [{ name: "Sam Muster", gender: "m", adult: true }] }, 5);
    expect(r.ok).toBe(true);
  });

  it("zählt m/w/d", () => {
    expect(countGenders([{ gender: "m" }, { gender: "w" }, { gender: "w" }, { gender: null }])).toEqual({ m: 1, w: 2, d: 0, unknown: 1 });
  });

  it("Gruppengröße inkl. Bucher", () => {
    const companions = Array.from({ length: 5 }, (_, i) => ({ name: `Gast Nummer${"abcde"[i]}`, gender: "m", adult: true }));
    expect(validateRequest({ ...base, companions }, 5).ok).toBe(false);
    expect(validateRequest({ ...base, companions: companions.slice(0, 4) }, 5).ok).toBe(true);
    expect(validateRequest({ ...base, notAttending: true, companions }, 5).ok).toBe(true);
  });

  it("nur für andere buchen braucht mindestens eine Person", () => {
    const r = validateRequest({ ...base, notAttending: true }, 5);
    expect(r.ok).toBe(false);
    const ok = validateRequest({ ...base, notAttending: true, companions: [{ name: "Sam Muster", gender: "d", adult: true }] }, 5);
    expect(ok.ok && ok.value.guests).toEqual([{ name: "Sam Muster", email: null, isBooker: false, gender: "d" }]);
  });

  it("Begleitung braucht 18+ und gültige optionale E-Mail", () => {
    const r = validateRequest({ ...base, companions: [{ name: "Sam Muster", email: "kaputt", adult: false }] }, 5);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["c0.adult", "c0.email", "c0.gender"]);
  });

  it("doppelte Namen in einer Anfrage", () => {
    const r = validateRequest({ ...base, companions: [{ name: "alex  beispiel", gender: "w", adult: true }] }, 5);
    expect(r.ok).toBe(false);
  });
});

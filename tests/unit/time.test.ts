import { describe, expect, it } from "vitest";
import { formatDate, formatTime, localInputToUtc, utcToLocalInput } from "@/domain/time";

const TZ = "Europe/Berlin";

describe("Zeitzonen", () => {
  it("Winterzeit (UTC+1)", () => {
    expect(localInputToUtc("2027-01-10T22:00", TZ)?.toISOString()).toBe("2027-01-10T21:00:00.000Z");
  });
  it("Sommerzeit (UTC+2)", () => {
    expect(localInputToUtc("2027-07-10T22:00", TZ)?.toISOString()).toBe("2027-07-10T20:00:00.000Z");
  });
  it("Rundreise", () => {
    for (const v of ["2027-03-28T01:30", "2027-03-28T03:30", "2027-10-31T12:00", "2027-12-31T23:59"]) {
      const d = localInputToUtc(v, TZ)!;
      expect(utcToLocalInput(d, TZ)).toBe(v);
    }
  });
  it("ungültige Eingabe", () => {
    expect(localInputToUtc("14.03.2027 22:00", TZ)).toBeNull();
  });
  it("Formatierung", () => {
    const d = new Date("2027-03-13T21:00:00Z");
    expect(formatDate(d, TZ)).toBe("SA 13.03.");
    expect(formatTime(d, TZ)).toBe("22:00");
  });
});

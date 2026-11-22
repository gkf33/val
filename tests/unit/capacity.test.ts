import { describe, expect, it } from "vitest";
import { CapacityError, assertFits, availabilityLevel, fitsInCapacity, freeSeats } from "@/domain/capacity";

describe("Kapazität", () => {
  it("berechnet freie Plätze, nie negativ", () => {
    expect(freeSeats({ capacity: 250, occupied: 213 })).toBe(37);
    expect(freeSeats({ capacity: 250, occupied: 260 })).toBe(0);
  });

  it("lässt genau bis zur Obergrenze zu, nicht darüber", () => {
    expect(fitsInCapacity({ capacity: 250, occupied: 245 }, 5)).toBe(true);
    expect(fitsInCapacity({ capacity: 250, occupied: 246 }, 5)).toBe(false);
    expect(() => assertFits({ capacity: 10, occupied: 10 }, 1)).toThrow(CapacityError);
  });

  it("Stufen für die Gästeanzeige", () => {
    expect(availabilityLevel({ capacity: 250, occupied: 100 })).toBe("frei");
    expect(availabilityLevel({ capacity: 250, occupied: 230 })).toBe("fast voll");
    expect(availabilityLevel({ capacity: 250, occupied: 250 })).toBe("ausgebucht");
  });
});

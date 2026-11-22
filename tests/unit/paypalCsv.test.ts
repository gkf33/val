import { describe, expect, it } from "vitest";
import { parsePaypalCsv } from "@/domain/paypalCsv";

// Synthetisch, Spalten nach bekannten Export-Formaten; mit echtem Export abgleichen.
const DE = `﻿"Datum","Uhrzeit","Zeitzone","Name","Typ","Status","Währung","Brutto","Gebühr","Netto","Absender E-Mail-Adresse","Empfänger E-Mail-Adresse","Transaktionscode","Hinweis"
"01.12.2026","20:01:02","Europe/Berlin","Erika Beispiel","Zahlung an Freunde/Familie erhalten","Abgeschlossen","EUR","40,00","0,00","40,00","erika@example.com","party@pay.example.org","9AB12345CD678901E","7KQ-M4X"
"01.12.2026","20:05:00","Europe/Berlin","Jonas Probe","Zahlung erhalten","Abgeschlossen","EUR","1.234,50","-35,00","1.199,50","jonas@example.com","party@pay.example.org","4TT33333EF4444455",""
"01.12.2026","21:00:00","Europe/Berlin","Bank","Allgemeine Abbuchung","Abgeschlossen","EUR","-100,00","0,00","-100,00","","","1AA00000000000000",""
"01.12.2026","21:10:00","Europe/Berlin","X","Zahlung erhalten","Ausstehend","EUR","20,00","0,00","20,00","","","2BB00000000000000",""`;

const EN = `"Date","Time","TimeZone","Name","Type","Status","Currency","Gross","Fee","Net","From Email Address","To Email Address","Transaction ID","Note"
"12/01/2026","20:01:02","CET","Erika Beispiel","Mobile Payment","Completed","EUR","20.00","0.00","20.00","erika@example.com","party@pay.example.org","6MN22222CD3333344","BZ5-HWS"`;

describe("PayPal-CSV", () => {
  it("deutscher Export: nur eingehende, abgeschlossene Zahlungen", () => {
    const r = parsePaypalCsv(DE);
    expect(r.missingColumns).toEqual([]);
    expect(r.skipped).toBe(2);
    expect(r.payments).toEqual([
      expect.objectContaining({ txId: "9AB12345CD678901E", grossCents: 4000, feeCents: 0, note: "7KQ-M4X", senderEmail: "erika@example.com" }),
      expect.objectContaining({ txId: "4TT33333EF4444455", grossCents: 123450, feeCents: 3500, note: null }),
    ]);
    expect(r.payments[0].paidAt?.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("englischer Export", () => {
    const r = parsePaypalCsv(EN);
    expect(r.payments[0]).toMatchObject({ txId: "6MN22222CD3333344", grossCents: 2000, note: "BZ5-HWS" });
  });

  it("fehlende Pflichtspalten werden gemeldet", () => {
    expect(parsePaypalCsv("a,b\n1,2").missingColumns).toEqual(["txId", "grossCents"]);
  });
});

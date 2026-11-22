import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { htmlToLines, parseAmount, parsePaypalMail } from "@/domain/paypalMail";

function fixture(name: string) {
  const raw = readFileSync(path.join(__dirname, "../fixtures/paypal", name), "utf8");
  const [head, ...body] = raw.split(/\r?\n\r?\n/);
  const subject = /^Subject: (.*)$/m.exec(head)![1].trim();
  return { subject, html: body.join("\n\n") };
}

describe("Betragsformate", () => {
  it("de und en", () => {
    expect(parseAmount("40,00", "de")).toBe(4000);
    expect(parseAmount("€ 1.234,50 EUR", "de")).toBe(123450);
    expect(parseAmount("20.00", "en")).toBe(2000);
    expect(parseAmount("1,234.50", "en")).toBe(123450);
    expect(parseAmount("abc", "de")).toBeNull();
  });
  it("HTML zu Zeilen inkl. Entities", () => {
    expect(htmlToLines("<p>A&nbsp;&amp;&nbsp;B</p><br>C&#252;")).toEqual(["A & B", "Cü"]);
  });
});

describe("PayPal-Mails (Fixtures)", () => {
  it("echte de-AT-Mail mit Mitteilung", () => {
    const r = parsePaypalMail(fixture("de-at-received-with-note.eml"));
    expect(r).toMatchObject({
      kind: "received",
      grossCents: 4000,
      currency: "EUR",
      senderName: "Erika Beispiel",
      note: "7KQ-M4X",
      txId: "9AB12345CD678901E",
      locale: "de",
      feeCents: null,
    });
    if (r.kind === "received") expect(r.paidAt?.toISOString().slice(0, 10)).toBe("2026-09-28");
  });

  it("echte de-AT-Mail ohne Mitteilung", () => {
    const r = parsePaypalMail(fixture("de-at-received-no-note.eml"));
    expect(r).toMatchObject({ kind: "received", grossCents: 2000, senderName: "Jonas Probe", note: null, txId: "3ZZ98765YX432101A" });
  });

  it("Zahler-Mails (gesendet, Pool) werden ignoriert", () => {
    expect(parsePaypalMail(fixture("de-at-sent.eml")).kind).toBe("ignored");
    expect(parsePaypalMail(fixture("de-at-pool.eml")).kind).toBe("ignored");
  });

  it("Umlaute, Cent-Beträge, Code im Fließtext", () => {
    const r = parsePaypalMail(fixture("de-received-multiline-note.eml"));
    expect(r).toMatchObject({ grossCents: 6007, senderName: "Jörg Groß-Müller", note: "danke! code: 7kq m4x" });
  });

  it("Tausendertrenner", () => {
    expect(parsePaypalMail(fixture("de-received-1234.eml"))).toMatchObject({ grossCents: 123450, note: null });
  });

  it("englische Variante (synthetisch)", () => {
    expect(parsePaypalMail(fixture("en-received-synthetic.eml"))).toMatchObject({
      kind: "received",
      grossCents: 2000,
      senderName: "Erika Beispiel",
      note: "BZ5-HWS",
      txId: "6MN22222CD3333344",
      locale: "en",
    });
  });

  it("fehlender Transaktionscode ist ein Fehler, kein stiller Treffer", () => {
    const r = parsePaypalMail({ subject: "x", html: "<p>Erika Beispiel hat Ihnen 20,00 EUR gesendet</p>" });
    expect(r.kind).toBe("error");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { MemoryMailer, setMailer } from "@/server/mail/mailer";
import { completeLogin, requestLogin } from "@/server/auth/login";
import { RateLimitError, consumeMagicToken, createMagicToken, peekMagicToken } from "@/server/auth/magicLink";

const mailer = new MemoryMailer();

beforeAll(() => {
  process.env.ADMIN_EMAILS = "boss@example.com";
  setMailer(mailer);
});
afterAll(() => prisma.$disconnect());

function tokenFromMail(): string {
  const text = mailer.sent.at(-1)!.text;
  return new URL(text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
}

describe("Magic-Link", () => {
  it("Admin bekommt einen Link, Fremde nicht", async () => {
    mailer.sent = [];
    await requestLogin("Boss@Example.com ", "admin");
    await requestLogin("fremd@example.com", "admin");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("boss@example.com");
  });

  it("Gäste-Login nur für bekannte Konten", async () => {
    mailer.sent = [];
    await requestLogin("neu@example.com", "guest");
    expect(mailer.sent).toHaveLength(0);
    await prisma.account.create({ data: { email: "bekannt@example.com" } });
    await requestLogin("bekannt@example.com", "guest");
    expect(mailer.sent).toHaveLength(1);
  });

  it("Token ist nur einmal gültig, Ansehen verbraucht ihn nicht", async () => {
    mailer.sent = [];
    await requestLogin("boss@example.com", "admin");
    const token = tokenFromMail();
    expect(await peekMagicToken(token)).not.toBeNull();
    expect(await peekMagicToken(token)).not.toBeNull();
    const first = await completeLogin(token);
    expect(first?.account.email).toBe("boss@example.com");
    expect(first?.redirect).toBe("/admin");
    expect(await completeLogin(token)).toBeNull();
    const logs = await prisma.auditLog.count({ where: { action: "admin.login" } });
    expect(logs).toBeGreaterThan(0);
  });

  it("gleichzeitiges Einlösen gelingt genau einmal", async () => {
    const token = await createMagicToken({ email: "race@example.com", purpose: "login" });
    const res = await Promise.all(Array.from({ length: 5 }, () => consumeMagicToken(token)));
    expect(res.filter(Boolean)).toHaveLength(1);
  });

  it("abgelaufene Tokens sind ungültig", async () => {
    const token = await createMagicToken({ email: "alt@example.com", purpose: "login", ttlMinutes: -1 });
    expect(await consumeMagicToken(token)).toBeNull();
  });

  it("Rate-Limit nach 5 Links in 15 Minuten", async () => {
    for (let i = 0; i < 5; i++) await createMagicToken({ email: "spam@example.com", purpose: "login" });
    await expect(createMagicToken({ email: "spam@example.com", purpose: "login" })).rejects.toBeInstanceOf(RateLimitError);
  });
});

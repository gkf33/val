/**
 * Seed-Daten für lokale Entwicklung. Idempotent: löscht und erzeugt neu.
 * Admin: erste Adresse aus ADMIN_EMAILS.
 */
import { PrismaClient, type GuestStatus } from "@prisma/client";
import { randomBytes, scryptSync } from "node:crypto";
import { generateLinkCode, generateReferenceCode } from "../src/domain/codes";

const token = () => randomBytes(18).toString("base64url");
function hashPin(pin: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pin, salt, 32).toString("hex")}`;
}

const prisma = new PrismaClient();
const DAY = 86_400_000;

async function main() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.refund.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.inboundEmail.deleteMany(),
    prisma.nameChangeRequest.deleteMany(),
    prisma.guest.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.doorDevice.deleteMany(),
    prisma.partyLink.deleteMany(),
    prisma.partyCost.deleteMany(),
    prisma.party.deleteMany(),
    prisma.session.deleteMany(),
    prisma.loginToken.deleteMany(),
    prisma.blocklist.deleteMany(),
    prisma.account.deleteMany(),
  ]);

  const adminEmail = (process.env.ADMIN_EMAILS ?? "admin@example.com").split(",")[0].trim().toLowerCase();
  await prisma.account.create({ data: { email: adminEmail, name: "Admin" } });

  // Party in 3 Wochen, Samstag 22:00 Berlin (≈ 21:00 UTC im Winter)
  const start = new Date(Date.now() + 21 * DAY);
  start.setUTCHours(21, 0, 0, 0);
  const party = await prisma.party.create({
    data: {
      name: "Nacht 07",
      slug: "nacht-07",
      status: "open",
      startsAt: start,
      endsAt: new Date(start.getTime() + 8 * 3_600_000),
      capacity: 250,
      feeCents: 2000,
      city: "München",
      address: "Beispielstraße 1, 80331 München",
      directions: "Hinterhof, zweite Tür links. Klingel „Lager“.",
      info: "Dresscode: dunkel.",
    },
  });
  await prisma.party.create({
    data: {
      name: "Nacht 08 (Entwurf)",
      slug: "nacht-08",
      status: "draft",
      startsAt: new Date(start.getTime() + 28 * DAY),
      endsAt: new Date(start.getTime() + 28 * DAY + 8 * 3_600_000),
      capacity: 200,
      feeCents: 2500,
    },
  });

  const publicLink = await prisma.partyLink.create({ data: { partyId: party.id, type: "public", code: "zugang23" } });
  const jonas = await prisma.partyLink.create({
    data: { partyId: party.id, type: "inviter", code: generateLinkCode(), inviterLabel: "Jonas" },
  });

  // Crew
  for (const [name, role, gender] of [["DJ Nord", "DJ", "m"], ["Mira", "Bar", "w"], ["Tom", "Host", "m"]] as const) {
    await prisma.guest.create({ data: { partyId: party.id, name, type: "crew", role, gender, status: "paid", adultConfirmed: true, ticketToken: token() } });
  }

  // Beispielbuchungen in verschiedenen Status
  const samples: { email: string; names: string[]; status: GuestStatus; via?: string }[] = [
    { email: "alex@example.com", names: ["Alex Beispiel", "Sam Muster"], status: "requested", via: jonas.id },
    { email: "kim@example.com", names: ["Kim Test"], status: "requested", via: publicLink.id },
    { email: "lea@example.com", names: ["Lea Probe", "Noah Probe", "Mia Probe"], status: "paid", via: jonas.id },
    { email: "ben@example.com", names: ["Ben Platz"], status: "approved_unpaid", via: publicLink.id },
    { email: "eva@example.com", names: ["Eva Warte"], status: "waitlisted", via: publicLink.id },
  ];
  for (const s of samples) {
    const account = await prisma.account.create({ data: { email: s.email, name: s.names[0] } });
    const approved = ["paid", "approved_unpaid"].includes(s.status);
    const booking = await prisma.booking.create({
      data: {
        partyId: party.id,
        accountId: account.id,
        email: s.email,
        bookerName: s.names[0],
        viaLinkId: s.via,
        referenceCode: generateReferenceCode(),
        confirmedAt: new Date(),
        approvedAt: approved ? new Date() : null,
        lockedAmountCents: approved ? s.names.length * party.feeCents : null,
        paymentDeadline: s.status === "approved_unpaid" ? new Date(Date.now() + 3_600_000) : null,
        guests: {
          create: s.names.map((name, i) => ({
            partyId: party.id,
            name,
            isBooker: i === 0,
            email: i === 0 ? s.email : null,
            adultConfirmed: true,
            gender: (["w", "m", "w", "d"] as const)[(i + name.length) % 4],
            status: s.status,
            ticketToken: s.status === "paid" ? token() : null,
          })),
        },
      },
    });
    if (s.status === "paid") {
      await prisma.payment.create({
        data: {
          paypalTxId: `SEED${booking.referenceCode.replace("-", "")}0000000`.slice(0, 17),
          grossCents: s.names.length * party.feeCents,
          senderName: s.names[0],
          note: booking.referenceCode,
          source: "manual",
          state: "matched",
          matchType: "manual",
          matchedBookingId: booking.id,
        },
      });
    }
  }

  // Door-Link (PIN 1234), gültig ab sofort bis Partyende + 6 h
  await prisma.partyLink.create({
    data: {
      partyId: party.id,
      type: "door",
      code: "tuer234567",
      pinHash: hashPin("1234"),
      validFrom: new Date(Date.now() - 3_600_000),
      validTo: new Date(party.endsAt.getTime() + 6 * 3_600_000),
    },
  });

  await prisma.blocklist.create({ data: { name: "Max Ärger", reason: "Beispiel-Eintrag" } });

  console.log("Seed fertig.");
  console.log(`  Admin:      ${adminEmail}  → http://localhost:3000/admin/login`);
  console.log(`  Party-Link: http://localhost:3000/p/nacht-07-zugang23`);
  console.log(`  Door:       http://localhost:3000/door/tuer234567  (PIN 1234)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * Bringt die Test-DB auf den aktuellen Migrationsstand und leert alle Tabellen.
 * Läuft nur gegen eine Datenbank, deren Name auf „_test“ endet.
 */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL fehlt (siehe .env.example)");
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Test-DB muss auf _test enden (ist: ${dbName})`);

  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  }
  await prisma.$disconnect();
}

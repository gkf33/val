import { execSync } from "node:child_process";
import { rmSync } from "node:fs";

export default function setup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("E2E_DATABASE_URL fehlt (siehe .env.example)");
  if (!new URL(url).pathname.endsWith("_e2e")) throw new Error("E2E-DB muss auf _e2e enden");
  const env = { ...process.env, DATABASE_URL: url, ADMIN_EMAILS: "admin@example.com" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" }); // Seed leert die DB vorher
  rmSync(".mail-outbox/e2e", { recursive: true, force: true });
}

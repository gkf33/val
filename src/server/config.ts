/** Zentrale Konfiguration aus Umgebungsvariablen (mit Standardwerten der Spezifikation). */

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} ist keine Zahl: ${v}`);
  return n;
}

function bool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const config = {
  get appUrl() {
    // Auf Vercel ohne APP_URL: Produktions-Domain des Projekts
    const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    return (process.env.APP_URL || (vercel ? `https://${vercel}` : "http://localhost:3000")).replace(/\/$/, "");
  },
  get appSecret() {
    const s = process.env.APP_SECRET;
    if (!s || s.length < 32) throw new Error("APP_SECRET fehlt oder ist kürzer als 32 Zeichen");
    return s;
  },
  get adminEmails(): string[] {
    return (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  get timeZone() {
    return process.env.TZ_DISPLAY ?? "Europe/Berlin";
  },
  rules: {
    get maxGroupSize() { return int("MAX_GROUP_SIZE", 5); },
    get maxBookingsPerAccount() { return int("MAX_BOOKINGS_PER_ACCOUNT", 1); },
    get paymentDeadlineMinutes() { return int("PAYMENT_DEADLINE_MINUTES", 60); },
    get paymentCutoffHours() { return int("PAYMENT_CUTOFF_HOURS", 24); },
    get paymentReminderMinutes() { return int("PAYMENT_REMINDER_MINUTES", 40); },
    get waitlistCutoffHours() { return int("WAITLIST_CUTOFF_HOURS", 24); },
    get selfCancelHours() { return int("SELF_CANCEL_HOURS", 72); },
    get dataRetentionDays() { return int("DATA_RETENTION_DAYS", 30); },
  },
  flags: {
    get trustedAutoApprove() { return bool("TRUSTED_AUTO_APPROVE"); },
    get uniqueCentAmounts() { return bool("UNIQUE_CENT_AMOUNTS"); },
    get walletPasses() { return bool("WALLET_PASSES"); },
  },
};

export function isAdminEmail(email: string): boolean {
  return config.adminEmails.includes(email.trim().toLowerCase());
}

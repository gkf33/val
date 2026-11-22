/**
 * DKIM-Prüfung der Rohmail. In Tests austauschbar (setDkimVerifier).
 */
import { authenticate } from "mailauth";

export interface DkimResult {
  valid: boolean;
  domains: string[];
}

export type DkimVerifier = (raw: string) => Promise<DkimResult>;

const defaultVerifier: DkimVerifier = async (raw) => {
  const res = await authenticate(raw, { trustReceived: false });
  const passed = (res.dkim?.results ?? [])
    .filter((r: { status?: { result?: string } }) => r.status?.result === "pass")
    .map((r: { signingDomain?: string }) => (r.signingDomain ?? "").toLowerCase())
    .filter(Boolean);
  return { valid: passed.length > 0, domains: passed };
};

let override: DkimVerifier | null = null;
export function setDkimVerifier(v: DkimVerifier | null) {
  override = v;
}

export function paypalDkimDomains(): string[] {
  return (process.env.PAYPAL_DKIM_DOMAINS ?? "paypal.com,paypal.de,paypal.at")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/** true, wenn eine gültige Signatur einer erlaubten PayPal-Domain vorliegt und der Absender dazu passt. */
export async function verifyPaypalDkim(raw: string, fromAddress: string | null): Promise<{ valid: boolean; domain: string | null }> {
  const r = await (override ?? defaultVerifier)(raw);
  const allowed = paypalDkimDomains();
  const fromDomain = fromAddress?.split("@")[1]?.toLowerCase() ?? "";
  const domain = r.domains.find((d) => allowed.includes(d) && (fromDomain === d || fromDomain.endsWith(`.${d}`))) ?? null;
  return { valid: r.valid && !!domain, domain };
}

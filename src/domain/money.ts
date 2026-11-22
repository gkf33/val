export function formatEuro(cents: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** „12,50“ oder „12.50“ → 1250. Gibt null bei ungültiger Eingabe. */
export function parseEuroToCents(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

/** PayPal.me-Betrag, z. B. 25 → „25“, 25.5 → „25.50“. */
export function paypalAmount(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

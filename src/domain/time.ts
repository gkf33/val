/**
 * Zeitzonen-Helfer ohne externe Bibliothek. Formulare arbeiten mit lokaler
 * Zeit (Europe/Berlin), die DB speichert UTC.
 */

function partsInZone(date: Date, timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = partsInZone(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** „2027-03-14T22:00“ (lokal in timeZone) → UTC-Date. null bei ungültiger Eingabe. */
export function localInputToUtc(value: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ts = guess - offsetMs(new Date(guess), timeZone);
  ts = guess - offsetMs(new Date(ts), timeZone); // Korrektur an DST-Grenzen
  return new Date(ts);
}

/** UTC-Date → Wert für <input type="datetime-local"> in timeZone. */
export function utcToLocalInput(date: Date, timeZone: string): string {
  const p = partsInZone(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone, weekday: "short", day: "2-digit", month: "2-digit" })
    .format(date)
    .toUpperCase()
    .replace(",", "")
    .replace(/^([A-ZÄÖÜ]+)\./, "$1");
}

export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone, hour: "2-digit", minute: "2-digit" }).format(date);
}

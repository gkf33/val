# Guestlist

Private Gästeverwaltung für Partys: Anfragen per Link, Freigabe durch Admins,
Unkostenbeitrag per PayPal, QR-Code, Pflicht-Check-in an der Tür.

Stack: Next.js 15 (App Router, TypeScript), Tailwind 4, PostgreSQL + Prisma 6,
eigener Magic-Link-Login, Vitest, Playwright.

## Stand: Phase 1

| Bereich | Status |
|---|---|
| Datenmodell (alle Phasen) | ✔ `prisma/schema.prisma` |
| Statusmaschine, Kapazität, Fristen, Codes | ✔ `src/domain/*` mit Unit-Tests |
| Kapazität mit DB-Locking (kein Überbuchen) | ✔ `src/server/capacity.ts`, Integrationstests inkl. Parallelität |
| Magic-Link-Login (Admin + Gäste) | ✔ Einmal-Token, gehasht, 15 min, Rate-Limit, Bestätigungsklick |
| Admin-Backend (mobil, installierbar) | ✔ Übersicht, Partys anlegen/bearbeiten, Links, Audit-Log |
| Party-Links + Einlader-Links | ✔ deaktivieren, neu erzeugen |
| Party-Seite für Gäste | ✔ Infos + freie Plätze; Formular folgt in Phase 2 |
| Mail-Versand | ✔ `console`, `file` oder `smtp` (z. B. Mailpit) |

## Lokal starten

Voraussetzungen: Node 20+, PostgreSQL 14+.

```bash
cp .env.example .env          # Werte prüfen, v. a. DATABASE_URL, ADMIN_EMAILS, APP_SECRET
npm install
npx prisma migrate dev        # Tabellen anlegen
npm run db:seed               # Beispieldaten (löscht vorhandene Daten!)
npm run dev
```

- Admin: <http://localhost:3000/admin/login> mit der ersten Adresse aus `ADMIN_EMAILS`.
  Bei `MAIL_TRANSPORT=console` steht der Login-Link im Terminal.
- Party-Seite aus dem Seed: <http://localhost:3000/p/nacht-07-zugang23>

Mails im Browser ansehen: [Mailpit](https://mailpit.axllent.org/) starten,
`MAIL_TRANSPORT=smtp`, `SMTP_PORT=1025`, Oberfläche unter <http://localhost:8025>.

## Tests

```bash
npm test            # Unit-Tests (ohne DB)
npm run test:db     # Integrationstests gegen TEST_DATABASE_URL (Name muss auf _test enden, wird geleert)
npm run test:e2e    # Playwright gegen E2E_DATABASE_URL (Name muss auf _e2e enden, wird neu befüllt)
```

## Aufbau

```
src/domain/     Reine Regeln: Statusmaschine, Kapazität, Fristen, Codes, Geld, Zeitzonen
src/server/     DB, Auth, Mail, Audit, Kapazität mit Locking, Partys/Links
src/app/        Seiten: /p/<slug>-<code> (Gäste), /admin (Backend), /auth/verify, /login, /me
src/components/ UI-Bausteine
prisma/         Schema, Migrationen, Seed
tests/          unit/, db/, e2e/
```

Design-Tokens (Farben, Schriften) liegen nur in `src/app/globals.css`.
Gäste-Seiten nutzen die Terminal-Schrift, das Admin-Backend Inter.

## Entscheidungen

- **Admins** = Adressen in `ADMIN_EMAILS`. Login nur per Magic-Link.
- **Magic-Links** werden erst per Klick auf „Weiter“ eingelöst, damit Mail-Scanner sie nicht entwerten.
- **Einlader-Links** sind eigene Codes (statt `?von=`), damit jeder einzeln deaktivierbar ist und nicht gefälscht werden kann.
- **Zahlungsfrist** pro Party in Minuten (Standard 60), gekappt durch „Zahlungen akzeptiert bis“
  bzw. Beginn − `PAYMENT_CUTOFF_HOURS`.
- **Zeiten** werden in UTC gespeichert und in `TZ_DISPLAY` (Europe/Berlin) angezeigt und eingegeben.
- **Cron** (ab Phase 3): Fristen werden zusätzlich bei jedem Zugriff geprüft;
  Erinnerungen über einen geschützten Endpoint, extern alle 5 min aufgerufen (z. B. cron-job.org).

## Noch offen (vom Betreiber)

Domain, PayPal-Privatkonto (`PAYPAL_ME_USER`), Inbound-Mail-Provider + MX-Eintrag,
echte PayPal-Zahlungsmails als Test-Fixtures (Freunde & Familie / Waren & Dienstleistungen, DE/EN).

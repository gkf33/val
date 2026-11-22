# Guestlist

Private Gästeverwaltung für Partys: Anfragen per Link, Freigabe durch Admins,
Unkostenbeitrag per PayPal, QR-Code, Pflicht-Check-in an der Tür.

Stack: Next.js 15 (App Router, TypeScript), Tailwind 4, PostgreSQL + Prisma 6,
eigener Magic-Link-Login, Vitest, Playwright.

## Stand: Phase 2

| Bereich | Status |
|---|---|
| Datenmodell (alle Phasen) | ✔ `prisma/schema.prisma` |
| Statusmaschine, Kapazität, Fristen, Codes, Personen | ✔ `src/domain/*` mit Unit-Tests |
| Kapazität mit DB-Locking (kein Überbuchen) | ✔ `src/server/capacity.ts`, Integrationstests inkl. Parallelität |
| Magic-Link-Login (Admin + Gäste) | ✔ Einmal-Token, gehasht, Rate-Limit, Bestätigungsklick |
| Admin-Backend (mobil, installierbar) | ✔ Übersicht, Partys, Links, Freigabe-Queue, Warteliste, Crew, Audit-Log |
| Gäste-Flow | ✔ Formular mit Begleitpersonen, E-Mail-Bestätigung, Status-Seite mit Zahlungsinfos |
| Freigabe | ✔ ganze Gruppe, einzelne Gäste, Bulk; Warnungen für Duplikate und Sperrliste; Historie; Ablehnen mit Nachricht |
| Zahlungsfrist | ✔ Betrag + Frist bei Freigabe festgeschrieben, Erinnerung, Ablauf, Admin-Hinweis „Platz frei“ |
| Zahlungseingang (PayPal-Mails) | Phase 3 |

### Gäste-Flow

1. `/p/<slug>-<code>`: Name wie im Ausweis, E-Mail, 18+, optional „komme nicht selbst“, bis zu `maxGroupSize` Personen.
   Wiederkehrende Gäste (eingeloggt) bekommen Name, E-Mail und frühere Begleitungen vorgeschlagen.
2. Bestätigungsmail (Link 24 h gültig). Erst danach: `requested`, oder `waitlisted`, wenn nicht genug Plätze frei sind.
3. `/me`: Status je Person; nach Freigabe Betrag, Frist, Referenzcode und PayPal-Button (`PAYPAL_ME_USER`).

### Fristen und Cron

Abgelaufene Fristen werden bei jedem Aufruf von Party-Seite, Status-Seite und Admin geprüft.
Für Erinnerungen und „Platz frei“-Mails zusätzlich alle 5 min aufrufen:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/tick
```

Kostenlos z. B. über cron-job.org; mit Vercel Pro alternativ Vercel Cron.

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
src/app/        Seiten: /p/<slug>-<code> (Gäste), /me (Status), /admin (Backend), /auth/verify, /login, /api/cron/tick
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

# Test-Deployment auf Vercel

Ziel: die App einmal online, um sie am Handy zu testen. Kostenlos, ohne eigene Domain.

## 1. Projekt anlegen

1. <https://vercel.com> → mit GitHub anmelden → **Add New… → Project** → Repo `gkf33/val` importieren.
2. **Production Branch** auf `claude/busy-babbage-xbex9i` stellen (Settings → Git), solange es keinen `main` gibt.
3. Framework: Next.js (wird erkannt). Build-Befehl nicht ändern; `vercel-build` führt Migrationen aus.

## 2. Datenbank (Neon, Frankfurt)

1. Im Vercel-Projekt → **Storage → Create Database → Neon** → Region **Frankfurt (eu-central-1)**.
2. Mit dem Projekt verbinden. Die Integration setzt `DATABASE_URL` (gepoolt) und `DATABASE_URL_UNPOOLED` (direkt).
   Prüfen unter Settings → Environment Variables; fehlt `DATABASE_URL_UNPOOLED`, die direkte
   Verbindungs-URL aus dem Neon-Dashboard eintragen (ohne `-pooler` im Hostnamen). Migrationen brauchen sie.

## 3. Umgebungsvariablen (Settings → Environment Variables)

| Name | Wert |
|---|---|
| `APP_SECRET` | langer Zufallswert, z. B. Ausgabe von `openssl rand -hex 32` |
| `ADMIN_EMAILS` | deine E-Mail-Adresse(n), komma-getrennt |
| `MAIL_TRANSPORT` | `console` (Login-Links stehen dann in den Logs, siehe unten) |
| `TZ_DISPLAY` | `Europe/Berlin` |
| `CRON_SECRET` | Zufallswert (für später) |
| `INBOUND_WEBHOOK_SECRET` | Zufallswert, mind. 16 Zeichen (für später) |

`APP_URL` kann leer bleiben; die App nimmt dann die Vercel-Adresse.

Danach **Deployments → Redeploy**.

## 4. Anmelden ohne Mail-Anbieter

Mit `MAIL_TRANSPORT=console` werden Mails nicht verschickt, sondern ins Log geschrieben:

1. Am Handy `https://<projekt>.vercel.app/admin/login` öffnen, eigene Adresse eingeben.
2. Vercel → Projekt → **Logs** → nach „MAIL an“ suchen → Link kopieren und am Handy öffnen.

Gleiches gilt für Bestätigungsmails von Test-Gästen.

### Später: echte Mails

Resend (kostenlos) per SMTP: `MAIL_TRANSPORT=smtp`, `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=465`,
`SMTP_USER=resend`, `SMTP_PASS=<API-Key>`, `MAIL_FROM="Guestlist <noreply@<domain>>"`.
Ohne eigene Domain stellt Resend nur an die eigene Konto-Adresse zu.

## 5. Durchspielen am Handy

1. Admin → **+ Party** → Status „Offen“ → speichern → Party-Link kopieren.
2. Party-Link in einem privaten Tab öffnen → Anfrage senden (eigene zweite Adresse) → Bestätigungslink aus den Logs.
3. Admin → **Freigabe** → freigeben.
4. Admin → **Zahlungen → Offen** → „Bezahlt markieren“ (PayPal-Eingang braucht Domain + Postmark).
5. Status-Seite des Gastes → QR-Code öffnen.
6. Admin → Party → **Einlass** → Door-Link mit PIN anlegen → auf zweitem Handy öffnen → QR-Code scannen.
   Hinweis: Der Door-Link gilt erst ab 2 h vor Partybeginn. Zum Testen eine Party mit Beginn in ≤ 2 h anlegen.

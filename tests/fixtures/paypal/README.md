# PayPal-Mail-Fixtures

| Datei | Herkunft |
|---|---|
| `de-at-received-with-note.eml` | Echte Empfänger-Mail (de-AT, Freunde & Familie), anonymisiert: Namen, Beträge, Transaktionscode, Mitteilung, Links ersetzt. HTML-Struktur original. |
| `de-at-received-no-note.eml` | Wie oben, Zahlung ohne Mitteilung. |
| `de-at-sent.eml`, `de-at-pool.eml` | Nachgebaut nach echten Zahler-Mails (nur Textinhalt). Müssen ignoriert werden. |
| `de-received-multiline-note.eml`, `de-received-1234.eml` | Synthetisch: Sonderfälle (Umlaute, Code im Fließtext, Tausendertrenner). |
| `en-received-synthetic.eml` | **Synthetisch, nicht verifiziert.** Englische Variante geraten; durch echte Mail ersetzen, sobald vorhanden. |

Die Header sind nachgebaut. Die DKIM-Signatur fehlt bewusst (die Originale lagen als .msg vor,
dort ist die Rohmail nicht byte-genau erhalten). DKIM wird in Tests per Stub simuliert.

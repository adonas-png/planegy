# PLANEGY Belegbox

Internes Werkzeug für Belege, als Ersatz für WellyBox. Es läuft als Google-Apps-Script im Konto adonas@planegy.de, durchsucht Gmail nach Rechnungen und Quittungen, liest sie mit Claude aus, legt sie in Google Drive ab und führt eine Belegliste in Google Sheets. Für den Steuerberater erzeugt es ein Monatspaket mit CSV, Excel und ZIP.

Nicht für den Verkauf gedacht, keine Mandantenfähigkeit.

## Was die App macht

| Schritt | Ablauf |
| --- | --- |
| Erfassen | Stündlicher Gmail-Scan nach Mails mit PDF- oder Bildanhang und Begriffen wie Rechnung, Invoice, Receipt, Quittung. Mails mit dem Label „Belege“ werden immer erfasst. Mails ohne Anhang, deren Text die Rechnung ist (Stripe, Paddle, App Store), werden als PDF gespeichert. Zusätzlich Upload über die Web-App, auf dem Handy direkt mit der Kamera. |
| Auslesen | Claude liest Aussteller, Empfänger, USt-IdNr., Rechnungsnummer, Datum, Netto, USt, Brutto, Währung, Zahlungsart, Reverse Charge und Dokumentart aus und schlägt eine Kategorie vor. |
| Einordnen | Ist PLANEGY der Aussteller, ist es ein Ausgangsbeleg und der Empfänger wird als Kunde eingetragen. Angebote, Pro-forma-Rechnungen, Auftragsbestätigungen, Bestellungen, Lieferscheine und Mahnungen werden ausgeschlossen. Regeln im Blatt „Regeln“ setzen Kategorie, Bereich (geschäftlich/privat) oder schließen Absender aus. |
| Dubletten | Gleiche Datei (SHA-256), gleiche Rechnungsnummer beim gleichen Partner, oder gleicher Partner mit gleichem Betrag innerhalb von 5 Tagen. Kommen Rechnung und Quittung zum selben Vorgang, bleibt die Rechnung. |
| Euro | Fremdwährungen werden mit dem EZB-Referenzkurs des Belegdatums umgerechnet (über api.frankfurter.app). |
| Ablage | Drive: `PLANEGY Belegbox/Belege/2026/2026-10/Eingang`, `…/Ausgang`, `…/Aussortiert`. Dateiname z. B. `2026-10-03_ER_Anthropic-PBC_INV-1234_21,42EUR.pdf`. |
| Prüfen | Web-App mit Liste, Filtern, Vorschau und Formular. Status: Neu, Prüfen, Freigegeben, Übermittelt, Dublette, Ausgeschlossen. |
| Weitergeben | Einzelbelege per Mail an eine Beleg-Adresse (DATEV Upload Mail, lexoffice, sevDesk). Monatspaket mit CSV (deutsches Format), Excel und ZIP, auf Wunsch als Gmail-Entwurf an den Steuerberater. Am 3. jedes Monats legt die App das Paket für den Vormonat automatisch als Entwurf an. Gesendet wird erst, wenn du den Entwurf abschickst. |

Kategorien tragen einen Kontovorschlag nach SKR03 (Blatt „Kategorien“, frei änderbar). Die endgültige Kontierung macht der Steuerberater.

## Einrichtung (ca. 15 Minuten)

### 1. Projekt anlegen

Mit adonas@planegy.de angemeldet auf [script.google.com](https://script.google.com) ein neues Projekt „PLANEGY Belegbox“ anlegen.

**Variante A, im Browser (empfohlen):** Im Ordner `dist/` liegen drei fertige Dateien zum Einfügen. Auf GitHub jeweils die Datei öffnen und oben rechts „Copy raw file“ klicken.

1. Im Apps-Script-Editor links auf das Zahnrad (Projekteinstellungen) und „Manifestdatei appsscript.json im Editor anzeigen“ einschalten.
2. Zurück im Editor (`<>`): `Code.gs` öffnen, alles markieren und durch den Inhalt von `dist/Code.gs` ersetzen. Speichern.
3. Neben „Dateien“ auf `+` › HTML, Name `Index` (ohne .html). Inhalt durch `dist/Index.html` ersetzen. Speichern.
4. `appsscript.json` öffnen und durch `dist/appsscript.json` ersetzen. Speichern.

**Variante B, mit clasp:**

```bash
npm install -g @google/clasp
```

```bash
clasp login
```

```bash
cd tools/belegbox && clasp create --type standalone --title "PLANEGY Belegbox"
```

```bash
git checkout appsscript.json && clasp push -f
```

`clasp create` überschreibt `appsscript.json` mit einer leeren Vorlage, daher das `git checkout` davor.

Vorher unter [script.google.com/home/usersettings](https://script.google.com/home/usersettings) die Apps Script API einschalten.

### 2. Einrichten ausführen

Im Editor oben in der Funktionsauswahl `einrichten` wählen und „Ausführen“ klicken. Google fragt nach Berechtigungen für Gmail, Drive, Sheets und externe Aufrufe. Weil die App nicht von Google geprüft ist, kommt ein Warnhinweis: „Erweitert“ und „Weiter zu PLANEGY Belegbox“ wählen.

Danach gibt es in Drive den Ordner „PLANEGY Belegbox“ mit der Belegliste, in Gmail die Labels „Belege“ und „Belege/erfasst“, und zwei Zeitauslöser (stündlicher Scan, Monatspaket am 3.).

### 3. Claude-API-Schlüssel

Auf [console.anthropic.com](https://console.anthropic.com) unter „API Keys“ einen Schlüssel erzeugen und ein Guthaben bzw. eine Zahlungsart hinterlegen. Den Schlüssel in der Web-App unter „Einstellungen“ eintragen, oder im Editor unter Projekteinstellungen › Skripteigenschaften als `ANTHROPIC_API_KEY`.

Ohne Schlüssel arbeitet die App trotzdem: Belege werden abgelegt und stehen auf „Prüfen“. „Neu auslesen“ holt die Auslesung später nach.

### 4. Web-App bereitstellen

Im Editor „Bereitstellen › Neue Bereitstellung › Web-App“. Ausführen als: Ich. Zugriff: Nur ich. Die URL als Lesezeichen speichern, auf dem Handy über „Zum Home-Bildschirm“ als App ablegen.

Nach Codeänderungen: „Bereitstellen › Bereitstellungen verwalten › Bearbeiten › Neue Version“.

### 5. Einstellungen prüfen

In der Web-App unter „Einstellungen“:

- **Erster Scan ab:** Standard ist 01.01.2026. Der erste Lauf arbeitet die Mails in Blöcken zu 25 ab, jede Stunde ein Block. Mit „Postfach scannen“ geht es schneller.
- **Steuerberater E-Mail** und Anrede eintragen.
- **Beleg-Mailadresse**, falls Herr Baumann mit DATEV Unternehmen online arbeitet und eine Upload-Mail-Adresse einrichtet (oder die Belegmail von lexoffice/sevDesk).

### 6. Belege vom Handy per Mail

Gmail unterstützt Plus-Adressen. Einen Filter anlegen: „An: adonas+belege@planegy.de“ › Label „Belege“ anwenden. Alles, was du an diese Adresse weiterleitest oder fotografiert schickst, landet beim nächsten Scan in der Belegbox.

### 7. WellyBox beenden

Vor dem 13.11.2026 den Test kündigen, in WellyBox Gmail- und WhatsApp-Verbindung trennen und die Löschung der Daten anfordern. In Google unter [myaccount.google.com/permissions](https://myaccount.google.com/permissions) den Zugriff von WellyBox entfernen.

## Kosten

Google Apps Script, Drive und Sheets sind im Workspace-Konto enthalten. Bezahlt wird nur die Claude-API nach Verbrauch, getrennt vom Claude-Pro-Abo.

| Modell | pro Beleg | 100 Belege im Monat |
| --- | --- | --- |
| `claude-haiku-5-5` (Standard) | ca. 0,1 Cent | ca. 0,10 USD |
| `claude-opus-5-5` (Knopf „Genau auslesen“) | ca. 3–4 Cent | ca. 3–4 USD |

Grundlage: etwa 4.000 Token Eingabe und 1.000 Token Antwort pro Beleg. Haiku reicht für normale PDF-Rechnungen. Bei unscharfen Fotos den Beleg in der App mit „Genau auslesen“ noch einmal mit Opus lesen lassen.

## Grenzen

- **Rechnungen nur im Online-Portal** (Telekom, Versicherer, Amazon Business ohne Mailversand) holt die App nicht ab. Diese Belege herunterladen und hochladen oder an die Plus-Adresse schicken.
- **Keine direkte DATEV-Schnittstelle.** Die Weitergabe läuft über Beleg-Mail, CSV und Excel. Ein DATEV-Buchungsstapel im EXTF-Format ist nicht eingebaut; das kann man ergänzen, wenn der Steuerberater es will.
- **GoBD:** Die Originale bleiben unverändert in Gmail und als Kopie in Drive, der SHA-256-Hash steht in der Liste. Google Drive ist aber kein zertifiziertes revisionssicheres Archiv. Mit dem Steuerberater klären, ob die Ablage so in die Verfahrensdokumentation passt oder ob die Belege zusätzlich in DATEV archiviert werden.
- **Datenschutz:** Zur Auslesung geht jede Belegdatei an die Anthropic-API. Den Auftragsverarbeitungsvertrag (DPA) aus den kommerziellen Bedingungen von Anthropic prüfen und ablegen. Mailtext wird nur als Auszug von 1.500 Zeichen mitgeschickt.
- **Apps-Script-Limits:** Ein Lauf darf höchstens 6 Minuten dauern, daher die Blöcke zu 25 Mails. Große Monatspakete über 18 MB gehen nicht als Mailanhang; dann den Drive-Ordner freigeben (Häkchen im Dialog).

## Dateien

| Datei | Inhalt |
| --- | --- |
| `dist/` | Fertige Dateien zum Einfügen im Browser, erzeugt mit `node tools/belegbox/build.js` |
| `Logic.gs` | Regeln, Dublettenerkennung, Dateinamen, CSV. Ohne Google-Dienste, mit Node testbar. |
| `Config.gs` | Einstellungen und Hilfsfunktionen für Drive und Sheets |
| `Setup.gs` | Einmalige Einrichtung |
| `Gmail.gs` | Postfach-Scan |
| `Extract.gs` | Auslesung mit der Claude-API |
| `Currency.gs` | Euro-Umrechnung |
| `Store.gs` | Belegliste, Ablage, Lieferantenstamm |
| `Export.gs` | Beleg-Mail und Monatspaket |
| `WebApp.gs`, `Index.html` | Weboberfläche |
| `test/logic.test.js` | Tests: `node tools/belegbox/test/logic.test.js` |

Der Ordner `tools/` wird nicht mit der Website ausgeliefert (`.assetsignore`, `netlify.toml`).

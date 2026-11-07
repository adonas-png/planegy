# Verfahrensdokumentation Belegerfassung (Entwurf)

PLANEGY, Inhaber Alexios Donas, Im Raisger 22, Waiblingen. Stand 07.11.2026.
Entwurf zur Abstimmung mit dem Steuerberater (Herr Baumann). Ersetzt keine steuerliche Beratung.

## 1. Zweck und Umfang

Die PLANEGY Belegbox erfasst Eingangs- und Ausgangsbelege, die per E-Mail an adonas@planegy.de eingehen oder von Hand hochgeladen werden, und stellt sie dem Steuerberater monatlich zur Buchung bereit. Gebucht wird beim Steuerberater, nicht in der Belegbox.

## 2. Beteiligte

| Rolle | Person | Aufgabe |
| --- | --- | --- |
| Erfassung und Freigabe | Alexios Donas | prüft ausgelesene Belege, gibt frei, lädt fehlende Belege hoch |
| Buchung und Archiv | Steuerberater | bucht nach dem Monatspaket, legt die Belege in seinem System ab |
| Technik | Google Apps Script im Konto adonas@planegy.de | Abruf, Auslesung, Ablage |

## 3. Ablauf

1. **Eingang.** Stündlich durchsucht die Belegbox Gmail nach Rechnungen, Quittungen und Gutschriften. Mails mit dem Label „Belege“ werden immer erfasst. Papierbelege werden fotografiert und über die Web-App hochgeladen.
2. **Ablage des Originals.** Die Originaldatei wird unverändert als Kopie in Google Drive gespeichert (Ordner „PLANEGY Belegbox/Belege/Jahr/Monat“). Die Original-Mail bleibt in Gmail. Für jede Datei wird ein SHA-256-Prüfwert in der Belegliste gespeichert.
3. **Auslesung.** Die Claude-API liest Aussteller, Datum, Beträge, Steuersatz und Dokumentart aus. Die Werte sind ein Vorschlag.
4. **Prüfung und Freigabe.** Alexios Donas prüft jeden Beleg in der Web-App gegen die Vorschau und gibt ihn frei. Korrekturen werden mit altem und neuem Wert im Blatt „Protokoll“ festgehalten. Doppelte Belege und Nicht-Belege (Angebote, Auftragsbestätigungen, Mahnungen) werden markiert, nicht gelöscht.
5. **Übergabe.** Am 3. des Folgemonats entsteht das Monatspaket mit allen freigegebenen Belegen des Vormonats (CSV, Excel, ZIP der Originale) als Gmail-Entwurf. Versand erst nach Durchsicht.
6. **Kontrolle.** Die Funktion „Dateien auf Veränderung prüfen“ vergleicht die Prüfwerte aller Dateien mit der Liste. Ergebnis im Blatt „Protokoll“. Durchführung mindestens vierteljährlich.

## 4. Aufbewahrung

- Originale: Gmail und Google Drive, Konto adonas@planegy.de. Keine Löschung vor Ablauf der gesetzlichen Fristen.
- Belegliste und Protokoll: Google Sheets „PLANEGY Belegbox – Belegliste“.
- Offen mit dem Steuerberater zu klären: ob die Ablage in Google Drive als Archiv ausreicht oder die Belege zusätzlich in DATEV archiviert werden.

## 5. Zugriff und Datenschutz

- Die Web-App ist nur für adonas@planegy.de zugänglich.
- Zur Auslesung wird jede Belegdatei an die Anthropic-API übertragen. Der Auftragsverarbeitungsvertrag (DPA) aus den kommerziellen Bedingungen von Anthropic ist abzulegen.
- Der API-Schlüssel liegt in den Skripteigenschaften, nicht im Code.

## 6. Änderungen am Verfahren

Änderungen am Programm erfolgen in `tools/belegbox/` im Git-Repository und werden mit Datum im Commit-Verlauf dokumentiert.

# Familienzentrale für Home Assistant

Ein Familienplaner als eigenes Panel in Home Assistant, für das Wand-Tablet und das Handy.

- 📅 **Familienkalender:** Personen mit eigener Farbe und eigenem Foto, Wochen- und Monatsansicht, Serientermine
- 🎒 **Schule & Freizeit:** Stundenplan, Sport und Hobbys mit „Mitnehmen“-Hinweis, Ferien
- ✅ **Aufgaben und Routinen:** täglich, an Wochentagen, im Intervall oder einmalig, auch reihum. Kinder haken am Display selbst ab.
- ⭐ **Punkte und Belohnungen:** Belohnungs-Shop, Bestätigung durch die Eltern, Punkteverlauf
- 🍽️ **Essensplan aus Mealie:** Zutaten gehen an die Bring-Einkaufsliste, automatisch, auf Knopfdruck oder nie
- 🔧 **Wartung:** Intervalle, Vorwarnung, Verlauf
- 🗑️ **Müllabfuhr:** von Hand erfasste Rhythmen, Erinnerung am Vorabend über Telegram oder Sonos
- 🖼️ **Bilderrahmen:** Diashow aus einem Medienordner, wenn niemand das Display benutzt
- 🔒 **Eltern-PIN** für Einstellungen und Bestätigungen

Alles wird in der Oberfläche eingestellt. Es gibt kein YAML.

## Status
In Entwicklung (Version 0.5.0).

| Teil | Stand |
|---|---|
| Personen, Einstellungen, Eltern-PIN | fertig |
| Kalender (HA-Kalender lesen, Termine anlegen und löschen) | fertig |
| Routinen (mehrere Personen, Wochentage, Schritte), Aufgaben (jeder / einer für alle / reihum), Punkte, Belohnungen, Verlauf | fertig |
| Symbolauswahl, Kalender nach Personen filtern | fertig |
| Wartung, Müll (Anzeige und Erfassung) | fertig |
| Einkauf über eine To-do-Liste (z. B. Bring) | fertig |
| Schule & Freizeit: Stundenplan pro Kind, Sport- und Freizeitaktivitäten (auch alle 2 Wochen, Saison, Pause in den Ferien), Ferien | fertig |
| Serientermine (täglich, wöchentlich mit Wochentagen, monatlich, jährlich; Ende nach Datum oder Anzahl) | fertig |
| Essensplan mit Mealie: Wochenplan lesen und schreiben, Rezeptsuche mit Bildern, Zutaten mit Mengen an die Einkaufsliste, Gerichtstypen wählbar | fertig |
| Erinnerungen über Telegram und Sonos | folgt |
| Bilderrahmen | folgt |

### Entitäten
- `sensor.familienzentrale_punkte_<person>` (Attribut `verfuegbar`)
- `sensor.familienzentrale_offene_aufgaben_<person>`
- `sensor.familienzentrale_nachste_mullabfuhr` (Datum, Attribut `arten`)
- `sensor.familienzentrale_fallige_wartungen`

### Ereignisse
`familienzentrale_aufgabe_erledigt`, `familienzentrale_belohnung_eingeloest` und `familienzentrale_wartung_erledigt` lassen sich in eigenen Automationen verwenden.

## Installation (HACS)
1. In HACS das Menü **⋮ → Benutzerdefinierte Repositories** öffnen und dieses Repository als Typ *Integration* hinzufügen.
2. **Familienzentrale** herunterladen und Home Assistant neu starten.
3. Unter *Einstellungen → Geräte & Dienste → Integration hinzufügen* die **Familienzentrale** auswählen.

## Voraussetzungen (optional)
- **Mealie:** die offizielle Integration [Mealie](https://www.home-assistant.io/integrations/mealie/)
- **Bring:** die offizielle Integration [Bring!](https://www.home-assistant.io/integrations/bring/)

## Tests
- `python tests/test_logic.py`: Fachlogik (Fälligkeit, Routinen, Punkte, Müll, Datenübernahme)
- `python tests/test_ingredients.py`: Zerlegung von Zutaten in Name und Menge
- `python tests/dev_server.py`: echtes Backend mit einer kleinen Home-Assistant-Attrappe, Panel unter `http://127.0.0.1:8770/tests/e2e.html`
  - Kompletter Klicktest in der Browser-Konsole: `await (await import('/tests/e2e_run.js')).run()`

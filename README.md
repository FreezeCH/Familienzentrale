# Familienzentrale für Home Assistant

Ein Familienplaner als eigenes Panel in Home Assistant, für das Wand-Tablet und das Handy.

- 📅 **Familienkalender:** Personen mit eigener Farbe und eigenem Foto, Wochen- und Monatsansicht
- ✅ **Aufgaben und Routinen:** täglich, an Wochentagen, im Intervall oder einmalig, auch reihum. Kinder haken am Display selbst ab.
- ⭐ **Punkte und Belohnungen:** Belohnungs-Shop, Bestätigung durch die Eltern, Punkteverlauf
- 🍽️ **Essensplan aus Mealie:** Zutaten gehen an die Bring-Einkaufsliste, automatisch, auf Knopfdruck oder nie
- 🔧 **Wartung:** Intervalle, Vorwarnung, Verlauf
- 🗑️ **Müllabfuhr:** von Hand erfasste Rhythmen, Erinnerung am Vorabend über Telegram oder Sonos
- 🖼️ **Bilderrahmen:** Diashow aus einem Medienordner, wenn niemand das Display benutzt
- 🔒 **Eltern-PIN** für Einstellungen und Bestätigungen

Alles wird in der Oberfläche eingestellt. Es gibt kein YAML.

## Status
In Entwicklung (Version 0.3.1).

| Teil | Stand |
|---|---|
| Personen, Einstellungen, Eltern-PIN | fertig |
| Kalender (HA-Kalender lesen, Termine anlegen und löschen) | fertig |
| Routinen (mehrere Personen, Wochentage, Schritte), Aufgaben (jeder / einer für alle / reihum), Punkte, Belohnungen, Verlauf | fertig |
| Symbolauswahl, Kalender nach Personen filtern | fertig |
| Wartung, Müll (Anzeige und Erfassung) | fertig |
| Einkauf über eine To-do-Liste (z. B. Bring) | fertig |
| Essensplan mit Mealie (Rezeptsuche, Plan, Zutaten) | folgt |
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
- `python tests/dev_server.py`: echtes Backend mit einer kleinen Home-Assistant-Attrappe, Panel unter `http://127.0.0.1:8770/tests/e2e.html`
  - Kompletter Klicktest in der Browser-Konsole: `await (await import('/tests/e2e_run.js')).run()`

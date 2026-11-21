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
In Entwicklung. Das Panel läuft bereits als Vorschau mit Demodaten. Das Backend (Etappe 1) folgt.

## Installation (HACS)
1. In HACS das Menü **⋮ → Benutzerdefinierte Repositories** öffnen und dieses Repository als Typ *Integration* hinzufügen.
2. **Familienzentrale** herunterladen und Home Assistant neu starten.
3. Unter *Einstellungen → Geräte & Dienste → Integration hinzufügen* die **Familienzentrale** auswählen.

## Voraussetzungen (optional)
- **Mealie:** die offizielle Integration [Mealie](https://www.home-assistant.io/integrations/mealie/)
- **Bring:** die offizielle Integration [Bring!](https://www.home-assistant.io/integrations/bring/)

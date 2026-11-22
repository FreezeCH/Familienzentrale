"""caldav_edit mit echter icalendar-Bibliothek prüfen (wird übersprungen, wenn sie fehlt).

Start: python tests/test_caldav_edit.py   (benötigt: pip install icalendar)
"""

import os
import sys
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "custom_components", "familienzentrale"))

try:
    import icalendar
except ImportError:  # pragma: no cover
    print("icalendar fehlt – übersprungen")
    sys.exit(0)

import caldav_edit  # noqa: E402

TZ = ZoneInfo("Europe/Zurich")
ICS = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:abc
DTSTAMP:20261120T080000Z
DTSTART;TZID=Europe/Zurich:20261122T090000
DTEND;TZID=Europe/Zurich:20261122T100000
SUMMARY:test
DESCRIPTION:Für Vater [fz:1]
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT
END:VCALENDAR
"""


class Obj:
    def __init__(self, store):
        self.store = store
        self.icalendar_instance = icalendar.Calendar.from_ical(store["ics"])

    @property
    def icalendar_component(self):
        return [c for c in self.icalendar_instance.subcomponents if c.name == "VEVENT"][0]

    def save(self):
        self.store["ics"] = self.icalendar_instance.to_ical().decode()

    def delete(self):
        self.store["ics"] = None


class Cal:
    def __init__(self):
        self.store = {"ics": ICS}

    def get_event_by_uid(self, uid):
        raise RuntimeError("ReportError at '412 Precondition Failed'")

    def search(self, start=None, end=None, event=True, expand=False):
        return [Obj(self.store)] if self.store["ics"] else []


class Ent:
    def __init__(self):
        self.coordinator = type("C", (), {})()
        self.coordinator.calendar = Cal()


def events(ent):
    cal = icalendar.Calendar.from_ical(ent.coordinator.calendar.store["ics"])
    return [c for c in cal.subcomponents if c.name == "VEVENT"]


def test_one_occurrence_override():
    ent = Ent()
    s, e = datetime(2026, 11, 23, 11, 0, tzinfo=TZ), datetime(2026, 11, 23, 12, 0, tzinfo=TZ)
    caldav_edit.update(ent, "abc", {"summary": "test2", "dtstart": s, "dtend": e, "description": "Für Vater [fz:1]"},
                       "2026-11-23 09:00:00+01:00", False)
    evs = events(ent)
    assert len(evs) == 2, evs
    master, ov = evs
    assert str(master["SUMMARY"]) == "test" and "EXDATE" not in master
    assert str(ov["UID"]) == "abc" and str(ov["SUMMARY"]) == "test2"
    assert ov["RECURRENCE-ID"].dt == datetime(2026, 11, 23, 9, 0, tzinfo=TZ)
    assert ov["DTSTART"].dt == s
    # zweites Bearbeiten derselben Ausnahme: keine zweite Ausnahme
    caldav_edit.update(ent, "abc", {"summary": "test3", "dtstart": s, "dtend": e}, "2026-11-23 09:00:00+01:00", False)
    evs = events(ent)
    assert len(evs) == 2 and str(evs[1]["SUMMARY"]) == "test3"
    # ganze Serie ab der Ausnahme: Master wird geändert, Datum bleibt
    caldav_edit.update(ent, "abc", {"summary": "neu", "dtstart": s, "dtend": e}, "2026-11-23 09:00:00+01:00", True)
    evs = events(ent)
    assert len(evs) == 1, "Ausnahme geht in der Serie auf"
    master = evs[0]
    assert str(master["SUMMARY"]) == "neu"
    assert master["DTSTART"].dt == datetime(2026, 11, 22, 11, 0, tzinfo=TZ)
    assert master["DTEND"].dt - master["DTSTART"].dt == timedelta(hours=1)
    # Ausnahme anlegen und löschen: EXDATE + Ausnahme entfernt
    caldav_edit.update(ent, "abc", {"summary": "x", "dtstart": s, "dtend": e}, "2026-11-23 11:00:00+01:00", False)
    assert len(events(ent)) == 2
    caldav_edit.delete(ent, "abc", "2026-11-23 11:00:00+01:00")
    evs = events(ent)
    assert len(evs) == 1 and "EXDATE" in evs[0]
    # Uhrzeit der ganzen Serie ändern: EXDATE wandert mit
    s2, e2 = datetime(2026, 11, 24, 14, 0, tzinfo=TZ), datetime(2026, 11, 24, 15, 0, tzinfo=TZ)
    caldav_edit.update(ent, "abc", {"summary": "neu", "dtstart": s2, "dtend": e2}, "2026-11-24 11:00:00+01:00", True)
    m = events(ent)[0]
    exd = [d.dt for d in (m["EXDATE"] if isinstance(m["EXDATE"], list) else [m["EXDATE"]])[0].dts]
    assert exd == [datetime(2026, 11, 23, 14, 0, tzinfo=TZ)], exd
    assert m["DTSTART"].dt == datetime(2026, 11, 22, 14, 0, tzinfo=TZ)
    # ganze Serie löschen
    caldav_edit.delete(ent, "abc", None, near="2026-11-22")
    assert ent.coordinator.calendar.store["ics"] is None


if __name__ == "__main__":
    test_one_occurrence_override()
    print("caldav_edit: ok")

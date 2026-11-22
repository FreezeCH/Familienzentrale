"""Tests der RRULE-Aufbereitung. Aufruf: python tests/test_rrule.py"""

import importlib.util
import sys
from datetime import date, datetime, timezone
from pathlib import Path

_path = Path(__file__).resolve().parents[1] / "custom_components" / "familienzentrale" / "rrule.py"
_spec = importlib.util.spec_from_file_location("fz_rrule", _path)
rr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rr)


def test_text_for_local_calendar():
    assert rr.for_platform("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4", "local_calendar") == "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4"
    assert rr.for_platform("RRULE:FREQ=DAILY", None) == "FREQ=DAILY"
    assert rr.for_platform("", "caldav") is None


def test_dict_for_caldav():
    d = rr.for_platform("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4", "caldav")
    assert d == {"FREQ": "WEEKLY", "INTERVAL": 2, "BYDAY": ["MO", "WE"], "COUNT": 4}, d
    d = rr.for_platform("FREQ=DAILY;UNTIL=20261231T225959Z", "caldav")
    assert d["UNTIL"] == datetime(2026, 12, 31, 22, 59, 59, tzinfo=timezone.utc), d
    d = rr.for_platform("FREQ=YEARLY;UNTIL=20301122", "caldav")
    assert d["UNTIL"] == date(2030, 11, 22), d
    d = rr.for_platform("FREQ=MONTHLY;BYMONTHDAY=15", "caldav")
    assert d == {"FREQ": "MONTHLY", "BYMONTHDAY": [15]}, d


if __name__ == "__main__":
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn()
                print("ok  ", name)
            except AssertionError as e:
                fails += 1
                print("FEHLER", name, e)
    sys.exit(1 if fails else 0)

"""Tests der Fachlogik (ohne Home Assistant). Aufruf: python tests/test_logic.py"""

import importlib.util
import sys
from datetime import date
from pathlib import Path

_path = Path(__file__).resolve().parents[1] / "custom_components" / "familienzentrale" / "logic.py"
_spec = importlib.util.spec_from_file_location("fz_logic", _path)
logic = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(logic)

D = date(2026, 11, 21)  # Samstag


def test_add_interval():
    assert logic.add_interval(date(2026, 1, 31), 1, "monate") == date(2026, 2, 28)
    assert logic.add_interval(date(2028, 2, 29), 1, "jahre") == date(2029, 2, 28)
    assert logic.add_interval(D, 2, "wochen") == date(2026, 12, 5)
    assert logic.add_interval(D, 3, "tage") == date(2026, 11, 24)


def test_task_due():
    assert logic.task_due({"repeat": {"type": "daily"}}, D)
    assert not logic.task_due({"repeat": {"type": "daily"}, "last_done": "2026-11-21"}, D)
    assert logic.task_due({"repeat": {"type": "weekly", "days": [5]}}, D)  # Samstag
    assert not logic.task_due({"repeat": {"type": "weekly", "days": [0, 1]}}, D)
    t = {"repeat": {"type": "interval", "every": 3, "unit": "tage"}, "last_done": "2026-11-19"}
    assert not logic.task_due(t, D)
    t["last_done"] = "2026-11-18"
    assert logic.task_due(t, D)
    assert logic.task_due({"repeat": {"type": "interval", "every": 3, "unit": "tage", "start": "2026-11-21"}}, D)
    assert not logic.task_due({"repeat": {"type": "interval", "every": 3, "unit": "tage", "start": "2026-11-22"}}, D)
    assert logic.task_due({"repeat": {"type": "once", "date": "2026-11-20"}}, D)
    assert not logic.task_due({"repeat": {"type": "once", "date": "2026-11-20"}, "last_done": "2026-11-20"}, D)


def test_rotation_and_person():
    t = {"persons": ["a", "b"], "rotate": True, "rotate_index": 3}
    assert logic.task_person(t, D) == "b"
    t.update(last_done="2026-11-21", last_by="a")
    assert logic.task_person(t, D) == "a"


def test_points():
    data = {
        "ledger": [{"person": "k", "delta": 30}, {"person": "k", "delta": -5}, {"person": "x", "delta": 9}],
        "pending": [{"person": "k", "points": -20}, {"person": "k", "points": 3}],
    }
    assert logic.points(data, "k") == 25
    assert logic.available(data, "k") == 5


def test_waste():
    w = {"rule": {"type": "weekly", "weekday": 1, "every_weeks": 2, "start": "2026-11-24"}}
    assert logic.waste_dates(w, 3, D) == [date(2026, 11, 24), date(2026, 12, 8), date(2026, 12, 22)]
    w["skip_dates"] = ["2026-12-08"]
    w["extra_dates"] = ["2026-12-09"]
    assert logic.waste_dates(w, 3, D) == [date(2026, 11, 24), date(2026, 12, 9), date(2026, 12, 22)]


def test_maint():
    assert logic.maint_status({"next": "2026-11-20"}, D) == "ueberfaellig"
    assert logic.maint_status({"next": "2026-11-25", "warn_days": 7}, D) == "bald"
    assert logic.maint_status({"next": "2026-12-25", "warn_days": 7}, D) == "ok"


if __name__ == "__main__":
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn()
                print("ok  ", name)
            except AssertionError:
                fails += 1
                print("FEHLER", name)
                import traceback
                traceback.print_exc()
    sys.exit(1 if fails else 0)

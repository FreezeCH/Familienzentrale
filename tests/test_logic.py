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
    assert logic.task_due_for({"repeat": {"type": "daily"}}, "a", D)
    assert not logic.task_due_for({"repeat": {"type": "daily"}, "done": {"a": "2026-11-21"}}, "a", D)
    assert logic.task_due_for({"repeat": {"type": "weekly", "days": [5]}}, "a", D)  # Samstag
    assert not logic.task_due_for({"repeat": {"type": "weekly", "days": [0, 1]}}, "a", D)
    t = {"repeat": {"type": "interval", "every": 3, "unit": "tage"}, "done": {"a": "2026-11-19"}}
    assert not logic.task_due_for(t, "a", D)
    t["done"]["a"] = "2026-11-18"
    assert logic.task_due_for(t, "a", D)
    assert logic.task_due_for({"repeat": {"type": "interval", "every": 3, "unit": "tage", "start": "2026-11-21"}}, "a", D)
    assert not logic.task_due_for({"repeat": {"type": "interval", "every": 3, "unit": "tage", "start": "2026-11-22"}}, "a", D)
    assert logic.task_due_for({"repeat": {"type": "once", "date": "2026-11-20"}}, "a", D)
    assert not logic.task_due_for({"repeat": {"type": "once", "date": "2026-11-20"}, "done": {"a": "2026-11-20"}}, "a", D)


def test_modes():
    jeder = {"persons": ["a", "b"], "mode": "jeder", "repeat": {"type": "daily"}, "done": {"a": "2026-11-21"}}
    assert not logic.task_due_for(jeder, "a", D) and logic.task_due_for(jeder, "b", D)
    gem = {"persons": ["a", "b"], "mode": "gemeinsam", "repeat": {"type": "daily"}, "done": {"*": "2026-11-21"}}
    assert not logic.task_due_for(gem, "a", D) and not logic.task_due_for(gem, "b", D)
    assert logic.task_assignees(gem, D) == ["a", "b"]


def test_rotation():
    t = {"persons": ["a", "b"], "mode": "reihum", "rotate_index": 3, "repeat": {"type": "daily"}}
    assert logic.task_assignees(t, D) == ["b"]
    t.update(done={"*": "2026-11-21"}, last_by="a", rotate_index=4)
    assert logic.task_assignees(t, D) == ["a"]


def test_routines():
    r = {"persons": ["a", "b"], "days": [5], "steps": [{"id": "s1"}, {"id": "s2"}], "done": {"a": {"date": "2026-11-21", "steps": ["s1"]}, "b": {"date": "2026-11-20", "steps": ["s1", "s2"]}}}
    assert logic.routine_today(r, D) and not logic.routine_today(r, date(2026, 11, 22))
    assert logic.routine_progress(r, "a", D) == (1, 2)
    assert logic.routine_progress(r, "b", D) == (0, 2)
    leer = {"persons": ["a"], "steps": [], "done": {"a": {"date": "2026-11-21", "steps": ["*"]}}}
    assert logic.routine_progress(leer, "a", D) == (1, 1)
    data = {"tasks": [{"persons": ["a"], "repeat": {"type": "daily"}}], "routines": [r]}
    assert logic.open_tasks(data, "a", D) == 2


def test_migrate():
    data = {
        "routines": [{"id": "r1", "name": "Abend", "person": "k", "time": "abend"}],
        "tasks": [
            {"id": "t1", "name": "Zähne", "routine": "r1", "points": 1, "persons": ["k"], "repeat": {"type": "daily"}},
            {"id": "t2", "name": "Tisch", "persons": ["k", "j"], "rotate": True, "last_done": "2026-11-21", "repeat": {"type": "daily"}},
            {"id": "t3", "name": "Bad", "persons": ["m"], "last_done": "2026-11-20", "repeat": {"type": "daily"}},
        ],
    }
    assert logic.migrate(data)
    r = data["routines"][0]
    assert r["persons"] == ["k"] and r["steps"][0]["name"] == "Zähne" and r["days"] == []
    assert [t["id"] for t in data["tasks"]] == ["t2", "t3"]
    assert data["tasks"][0]["mode"] == "reihum" and data["tasks"][0]["done"] == {"*": "2026-11-21"}
    assert data["tasks"][1]["mode"] == "jeder" and data["tasks"][1]["done"] == {"m": "2026-11-20"}
    assert not logic.migrate(data)


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


def test_waste_anchor():
    # Start an einem Sonntag, Abfuhr dienstags alle 2 Wochen -> erster Termin ist der Dienstag danach
    w = {"rule": {"type": "weekly", "weekday": 1, "every_weeks": 2, "start": "2026-11-22"}}
    assert logic.waste_dates(w, 2, D) == [date(2026, 11, 24), date(2026, 12, 8)]
    w = {"rule": {"type": "weekly", "weekday": 1, "every_weeks": 1}}
    assert logic.waste_dates(w, 1, D) == [date(2026, 11, 24)]


def test_version_sync():
    import re
    root = Path(__file__).resolve().parents[1] / "custom_components" / "familienzentrale"
    const = re.search(r'VERSION = "([^"]+)"', (root / "const.py").read_text(encoding="utf-8")).group(1)
    panel = re.search(r'PANEL_VERSION = "([^"]+)"', (root / "frontend" / "familienzentrale-panel.js").read_text(encoding="utf-8")).group(1)
    manifest = re.search(r'"version": "([^"]+)"', (root / "manifest.json").read_text(encoding="utf-8")).group(1)
    assert const == panel == manifest, (const, panel, manifest)


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

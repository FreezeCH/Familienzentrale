"""Fachlogik der Familienzentrale (ohne Home-Assistant-Abhängigkeiten, gut testbar).

Entspricht der Logik im Panel (``Logic`` in familienzentrale-panel.js).
Wochentage: Montag = 0 … Sonntag = 6.
"""

from __future__ import annotations

import calendar as _cal
from datetime import date, timedelta
from typing import Any


def parse(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def add_interval(d: date, every: Any, unit: str | None) -> date:
    n = int(every or 1)
    if n < 1:
        n = 1
    if unit == "wochen":
        return d + timedelta(weeks=n)
    if unit == "monate":
        month = d.month - 1 + n
        year = d.year + month // 12
        month = month % 12 + 1
        day = min(d.day, _cal.monthrange(year, month)[1])
        return date(year, month, day)
    if unit == "jahre":
        try:
            return d.replace(year=d.year + n)
        except ValueError:  # 29. Februar
            return d.replace(year=d.year + n, day=28)
    return d + timedelta(days=n)


def points(data: dict, person_id: str) -> int:
    return sum(int(l.get("delta") or 0) for l in data.get("ledger", []) if l.get("person") == person_id)


def available(data: dict, person_id: str) -> int:
    """Punktestand minus noch nicht bestätigte Einlösungen."""
    reserved = sum(
        int(p.get("points") or 0)
        for p in data.get("pending", [])
        if p.get("person") == person_id and int(p.get("points") or 0) < 0
    )
    return points(data, person_id) + reserved


# ---------- Aufgaben ----------
# Zuteilung (mode):
#   "jeder"     jede zugeteilte Person erledigt die Aufgabe für sich
#   "gemeinsam" einer für alle: sobald jemand sie erledigt, ist sie für alle erledigt
#   "reihum"    die zuständige Person wechselt nach jedem Erledigen
# Erledigt-Stand: task["done"] = {person_id oder "*": "JJJJ-MM-TT"}


def task_mode(task: dict) -> str:
    return task.get("mode") or "jeder"


def task_key(task: dict, person_id: str | None) -> str:
    if task_mode(task) == "jeder":
        return person_id or "*"
    return "*"


def _last_done(task: dict, person_id: str | None) -> date | None:
    return parse((task.get("done") or {}).get(task_key(task, person_id)))


def task_done_for(task: dict, person_id: str | None, day: date) -> bool:
    return _last_done(task, person_id) == day


def task_due_for(task: dict, person_id: str | None, day: date) -> bool:
    """Ist die Aufgabe heute für diese Person (noch) fällig?"""
    r = task.get("repeat") or {"type": "once"}
    last = _last_done(task, person_id)
    if last == day:
        return False
    typ = r.get("type")
    if typ == "daily":
        return True
    if typ == "weekly":
        return day.weekday() in [int(x) for x in (r.get("days") or [])]
    if typ == "interval":
        if last:
            return add_interval(last, r.get("every"), r.get("unit")) <= day
        start = parse(r.get("start")) or day
        return start <= day
    if last:  # einmalig und schon erledigt
        return False
    return (parse(r.get("date")) or day) <= day


def task_assignees(task: dict, day: date) -> list[str]:
    """Wer sieht die Aufgabe heute in seiner Liste?"""
    persons = list(task.get("persons") or [])
    if task_mode(task) == "reihum" and persons:
        if task_done_for(task, None, day) and task.get("last_by"):
            return [task["last_by"]]
        return [persons[int(task.get("rotate_index") or 0) % len(persons)]]
    return persons


def task_today(task: dict, person_id: str, day: date) -> bool:
    """Gehört die Aufgabe heute zu dieser Person (offen oder heute erledigt)?"""
    if person_id not in task_assignees(task, day):
        return False
    return task_due_for(task, person_id, day) or task_done_for(task, person_id, day)


# ---------- Routinen ----------
# routine = {persons, days (leer = täglich), time, steps: [{id, name, icon, points}],
#            points (nur ohne Schritte), done: {person_id: {"date": ..., "steps": [...]}}}


def routine_today(routine: dict, day: date) -> bool:
    days = [int(x) for x in (routine.get("days") or [])]
    return not days or day.weekday() in days


def routine_done_steps(routine: dict, person_id: str, day: date) -> list[str]:
    rec = (routine.get("done") or {}).get(person_id) or {}
    return list(rec.get("steps") or []) if rec.get("date") == day.isoformat() else []


def routine_progress(routine: dict, person_id: str, day: date) -> tuple[int, int]:
    """(erledigt, gesamt) – eine Routine ohne Schritte zählt als ein Schritt."""
    steps = routine.get("steps") or []
    done = routine_done_steps(routine, person_id, day)
    if not steps:
        return (1 if "*" in done else 0, 1)
    ids = {s.get("id") for s in steps}
    return (len([x for x in done if x in ids]), len(steps))


def open_tasks(data: dict, person_id: str, day: date) -> int:
    n = sum(
        1
        for t in data.get("tasks", [])
        if person_id in task_assignees(t, day) and task_due_for(t, person_id, day)
    )
    for r in data.get("routines", []):
        if person_id in (r.get("persons") or []) and routine_today(r, day):
            done, total = routine_progress(r, person_id, day)
            n += total - done
    return n


# ---------- Übernahme älterer Daten (Version 0.2) ----------


def migrate(data: dict) -> bool:
    """Bringt Routinen und Aufgaben aus 0.2 ins neue Modell. Gibt True zurück, wenn etwas geändert wurde."""
    changed = False
    routines = {r.get("id"): r for r in data.get("routines", [])}
    for r in routines.values():
        if "persons" not in r:
            r["persons"] = [r["person"]] if r.get("person") else []
            r.pop("person", None)
            changed = True
        r.setdefault("days", [])
        r.setdefault("steps", [])
        r.setdefault("done", {})
    keep = []
    for t in data.get("tasks", []):
        rid = t.get("routine")
        if rid and rid in routines:
            routines[rid]["steps"].append(
                {"id": t.get("id"), "name": t.get("name", ""), "icon": t.get("icon", ""), "points": int(t.get("points") or 0)}
            )
            if t.get("needs_approval"):
                routines[rid]["needs_approval"] = True
            changed = True
            continue
        if "mode" not in t:
            t["mode"] = "reihum" if t.get("rotate") else "jeder"
            t.pop("rotate", None)
            changed = True
        if "done" not in t:
            t["done"] = {}
            if t.get("last_done"):
                key = "*" if t["mode"] != "jeder" else (t.get("last_by") or (t.get("persons") or ["*"])[0])
                t["done"][key] = t["last_done"]
            changed = True
        t.pop("last_done", None)
        t.pop("routine", None)
        keep.append(t)
    if len(keep) != len(data.get("tasks", [])):
        data["tasks"] = keep
    return changed


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def waste_dates(waste: dict, count: int, from_day: date) -> list[date]:
    out: list[date] = []
    rule = waste.get("rule") or {}
    skip = {parse(s) for s in waste.get("skip_dates") or []}
    if rule.get("type") == "weekly" and rule.get("weekday") is not None:
        every = int(rule.get("every_weeks") or 1) or 1
        wday = int(rule["weekday"])
        # Rhythmus beginnt beim ersten passenden Wochentag am oder nach dem Startdatum
        st0 = parse(rule.get("start")) or from_day
        anchor = st0 + timedelta(days=(wday - st0.weekday()) % 7)
        for i in range(400):
            d = from_day + timedelta(days=i)
            if d.weekday() != wday or d in skip:
                continue
            days = (d - anchor).days
            if days >= 0 and (days // 7) % every == 0:
                out.append(d)
                if len(out) >= count + 5:
                    break
    for s in waste.get("extra_dates") or []:
        d = parse(s)
        if d and d >= from_day and d not in skip:
            out.append(d)
    return sorted(set(out))[:count]


def maint_status(m: dict, day: date) -> str:
    nxt = parse(m.get("next"))
    if not nxt:
        return "ok"
    if nxt < day:
        return "ueberfaellig"
    if (nxt - day).days <= int(m.get("warn_days") or 0):
        return "bald"
    return "ok"

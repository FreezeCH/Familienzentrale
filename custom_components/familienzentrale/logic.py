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


def task_due(task: dict, day: date) -> bool:
    r = task.get("repeat") or {"type": "once"}
    last = parse(task.get("last_done"))
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
    # einmalig
    if last:
        return False
    return (parse(r.get("date")) or day) <= day


def task_done_today(task: dict, day: date) -> bool:
    return parse(task.get("last_done")) == day


def task_person(task: dict, day: date) -> str | None:
    persons = task.get("persons") or []
    if task_done_today(task, day) and task.get("last_by"):
        return task["last_by"]
    if not persons:
        return None
    if not task.get("rotate"):
        return persons[0]
    return persons[int(task.get("rotate_index") or 0) % len(persons)]


def open_tasks(data: dict, person_id: str, day: date) -> int:
    return sum(
        1
        for t in data.get("tasks", [])
        if task_person(t, day) == person_id and task_due(t, day)
    )


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def waste_dates(waste: dict, count: int, from_day: date) -> list[date]:
    out: list[date] = []
    rule = waste.get("rule") or {}
    skip = {parse(s) for s in waste.get("skip_dates") or []}
    if rule.get("type") == "weekly" and rule.get("weekday") is not None:
        every = int(rule.get("every_weeks") or 1) or 1
        start = week_start(parse(rule.get("start")) or from_day)
        wday = int(rule["weekday"])
        for i in range(400):
            d = from_day + timedelta(days=i)
            if d.weekday() != wday or d in skip:
                continue
            weeks = (week_start(d) - start).days // 7
            if weeks >= 0 and weeks % every == 0:
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

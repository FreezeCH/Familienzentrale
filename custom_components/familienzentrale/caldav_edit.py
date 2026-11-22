"""Termine in CalDAV-Kalendern ändern und löschen.

Die HA-Integration „caldav“ kann Termine nur anlegen. Damit Bearbeiten und Löschen trotzdem
gehen, nutzt die Familienzentrale die bereits angemeldete Verbindung dieser Integration
(``entity.coordinator.calendar``, ein ``caldav.Calendar``). Es werden keine eigenen Zugangsdaten
gespeichert. Ändert HA diese interne Struktur, liefert ``available()`` False und das Panel
bietet Bearbeiten/Löschen nicht an.

Alle Funktionen hier sind blockierend und laufen im Executor.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any


def calendar_of(entity: Any) -> Any | None:
    coord = getattr(entity, "coordinator", None)
    cal = getattr(coord, "calendar", None)
    if cal is None:
        return None
    if not any(hasattr(cal, n) for n in ("event_by_uid", "get_event_by_uid", "object_by_uid")):
        return None
    return cal


def available(entity: Any) -> bool:
    return calendar_of(entity) is not None


def _uid_of(obj: Any) -> str:
    try:
        return str(obj.icalendar_component.get("UID") or "")
    except Exception:  # noqa: BLE001
        return ""


def _as_dt(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    try:
        v = _parse_rid(str(value))
    except ValueError:
        return None
    return _as_dt(v)


def _find(cal: Any, uid: str, near: Any = None) -> Any:
    """Termin über seine UID finden.

    Zuerst die übliche UID-Suche. Manche Server (z. B. iCloud) lehnen diese ab
    („412 Precondition Failed“); dann wird über den Zeitraum gesucht und die UID verglichen.
    """
    for name in ("get_event_by_uid", "event_by_uid", "object_by_uid"):
        fn = getattr(cal, name, None)
        if fn is None:
            continue
        try:
            return fn(uid)
        except Exception:  # noqa: BLE001 - Ersatzweg unten
            break
    windows = []
    center = _as_dt(near)
    if center is not None:
        windows.append((center - timedelta(days=2), center + timedelta(days=2)))
    now = datetime.now(timezone.utc)
    windows.append((now - timedelta(days=400), now + timedelta(days=400)))
    for start, end in windows:
        try:
            found = cal.search(start=start, end=end, event=True, expand=False)
        except TypeError:
            found = cal.date_search(start, end)
        for obj in found or []:
            if _uid_of(obj) == uid:
                return obj
    raise LookupError("Termin auf dem Server nicht gefunden")


def _comp(ev: Any) -> Any:
    comp = getattr(ev, "icalendar_component", None)
    if comp is None:
        raise LookupError("Termin hat keinen Inhalt")
    return comp


def _set(comp: Any, key: str, value: Any) -> None:
    if key.upper() in comp:
        comp.pop(key.upper())
    if value not in (None, ""):
        comp.add(key.lower(), value)


def _parse_rid(rid: str) -> date | datetime:
    """recurrence_id aus HA ("2026-11-23 09:00:00+01:00" oder "2026-11-23") -> date/datetime."""
    rid = str(rid).strip()
    if len(rid) == 10:
        return date.fromisoformat(rid)
    if len(rid) == 8 and rid.isdigit():
        return date(int(rid[:4]), int(rid[4:6]), int(rid[6:8]))
    return datetime.fromisoformat(rid.replace(" ", "T"))


def delete(entity: Any, uid: str, recurrence_id: str | None = None, near: Any = None) -> None:
    """Ganzen Termin bzw. ganze Serie löschen; mit recurrence_id nur dieses eine Vorkommen (EXDATE)."""
    cal = calendar_of(entity)
    if cal is None:
        raise RuntimeError("CalDAV-Verbindung nicht verfügbar")
    ev = _find(cal, uid, near or recurrence_id)
    if recurrence_id:
        comp = _comp(ev)
        comp.add("exdate", _parse_rid(recurrence_id))
        ev.save()
    else:
        ev.delete()


def update(entity: Any, uid: str, changes: dict[str, Any], recurrence_id: str | None = None, whole_series: bool = False, near: Any = None) -> None:
    """Termin ändern.

    changes: summary, description, location, dtstart, dtend (date oder aware datetime)
    - Einzeltermin: alles wird übernommen.
    - Ganze Serie: Titel/Beschreibung/Ort; Uhrzeit und Dauer werden auf den Serienbeginn übertragen
      (das Datum des Serienbeginns bleibt).
    - Nur ein Vorkommen einer Serie: dieses Vorkommen wird ausgenommen (EXDATE) und als
      einzelner Termin neu angelegt.
    """
    cal = calendar_of(entity)
    if cal is None:
        raise RuntimeError("CalDAV-Verbindung nicht verfügbar")
    ev = _find(cal, uid, near or recurrence_id)
    comp = _comp(ev)
    is_series = "RRULE" in comp
    if is_series and recurrence_id and not whole_series:
        comp.add("exdate", _parse_rid(recurrence_id))
        ev.save()
        new = {k: v for k, v in changes.items() if v not in (None, "")}
        cal.add_event(**new)
        return
    for key in ("summary", "description", "location"):
        if key in changes:
            _set(comp, key, changes[key])
    if "dtstart" in changes and "dtend" in changes:
        start, end = changes["dtstart"], changes["dtend"]
        if is_series:
            old = comp.get("DTSTART").dt
            if isinstance(start, datetime) and isinstance(old, datetime):
                base = old.astimezone(start.tzinfo) if old.tzinfo else old
                start2 = base.replace(hour=start.hour, minute=start.minute, second=0, microsecond=0)
                end = start2 + (end - start)
                start = start2
            elif isinstance(old, date) and not isinstance(old, datetime) and not isinstance(start, datetime):
                end = old + (end - start)
                start = old
        _set(comp, "dtstart", start)
        _set(comp, "dtend", end)
        if "DURATION" in comp:
            comp.pop("DURATION")
    ev.save()


"""Wiederholungsregeln (RRULE) für verschiedene Kalender-Integrationen aufbereiten (ohne HA-Abhängigkeiten).

- Lokaler Kalender, Google u. a.: Text wie "FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4"
- CalDAV (z. B. iCloud): die caldav-Bibliothek erwartet ein Wörterbuch wie
  {"FREQ": "WEEKLY", "BYDAY": ["MO", "WE"], "COUNT": 4}, UNTIL als Datum/Zeit.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

_INT_KEYS = {"COUNT", "INTERVAL", "BYMONTHDAY", "BYMONTH", "BYSETPOS"}
_LIST_KEYS = {"BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS"}


def parse_until(value: str) -> date | datetime:
    v = value.strip()
    if len(v) == 8:
        return date(int(v[:4]), int(v[4:6]), int(v[6:8]))
    dt = datetime(int(v[:4]), int(v[4:6]), int(v[6:8]), int(v[9:11]), int(v[11:13]), int(v[13:15]))
    return dt.replace(tzinfo=timezone.utc) if v.endswith("Z") else dt


def rrule_to_dict(rrule: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for part in str(rrule or "").removeprefix("RRULE:").split(";"):
        if "=" not in part:
            continue
        key, val = part.split("=", 1)
        key = key.strip().upper()
        if key == "UNTIL":
            out[key] = parse_until(val)
        elif key in _LIST_KEYS:
            items = [x.strip() for x in val.split(",") if x.strip()]
            out[key] = [int(x) for x in items] if key in _INT_KEYS else items
        elif key in _INT_KEYS:
            out[key] = int(val)
        else:
            out[key] = val.strip().upper()
    return out


def for_platform(rrule: str, platform: str | None) -> Any:
    """RRULE in dem Format, das die jeweilige Kalender-Integration annimmt."""
    rule = str(rrule or "").strip().removeprefix("RRULE:")
    if not rule:
        return None
    if platform == "caldav":
        return rrule_to_dict(rule)
    return rule

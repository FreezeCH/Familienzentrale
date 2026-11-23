"""Zentrale der Familienzentrale: Datenhaltung, Aktionen und Anbindung an Home Assistant."""

from __future__ import annotations

import copy
import hashlib
import logging
import secrets
import time
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from . import logic
from .ingredients import norm
from .mealie import MealieBridge
from .rrule import for_platform as rrule_for_platform
from . import caldav_edit
from . import photos
from . import notifier
from .const import (
    CAL_DAYS_AHEAD,
    CAL_DAYS_BACK,
    COLLECTIONS,
    EVENT_MAINT_DONE,
    EVENT_REWARD_REDEEMED,
    EVENT_TASK_DONE,
    PIN_UNLOCK_SECONDS,
    STORAGE_KEY,
    STORAGE_VERSION,
    VERSION,
)

_LOGGER = logging.getLogger(__name__)

PIN_ITERATIONS = 60000

DEFAULT_DATA: dict[str, Any] = {
    "settings": {
        "theme": "hell",
        "title": "Familienzentrale",
        "modules": {
            "schule": True,
            "kalender": True,
            "aufgaben": True,
            "punkte": True,
            "essen": True,
            "einkauf": True,
            "wartung": True,
            "muell": True,
            "bilderrahmen": False,
        },
        "lock_calendar": True,
        "family_calendar": "",
        "frame": {
            "enabled": True,
            "idle_min": 3,
            "interval_s": 10,
            "night_from": "22:00",
            "night_to": "06:00",
            "media": "",
        },
        "notify": {
            "targets": [],  # Empfänger für Push/Telegram (notify.mobile_app_xyz oder notify.xyz)
            "sonos": [],  # Lautsprecher für Ansagen
            "tts": "",  # Sprachausgabe (leer = erste vorhandene)
            "language": "de",
            "volume": 0.35,
            "quiet_from": "21:00",  # keine Ansagen in dieser Zeit
            "quiet_to": "07:00",
            "waste_time": "19:00",
            "maint_time": "08:00",
            "link": "/familienzentrale",
            "events": {
                "approval": {"push": True, "sonos": False},
                "waste": {"push": True, "sonos": True},
                "maintenance": {"push": True, "sonos": False},
            },
        },
        "mealie": {"to_bring": "button", "bring_list": "", "slots": ["fruehstueck", "mittag", "abend"], "skip": ["Salz", "Pfeffer", "Salz, Pfeffer", "Wasser"], "servings": 4},
        "pin": None,  # {"salt": ..., "hash": ...}
    },
    "persons": [],
    "tasks": [],
    "routines": [],
    "rewards": [],
    "ledger": [],
    "pending": [],
    "notify_log": {},
    "history": [],
    "maintenance": [],
    "waste": [],
    "meals": {},
    "meal_servings": {},
    # Schule & Freizeit
    "timetable": [],   # {id, person, days[], start, end, subject, icon, room}
    "activities": [],  # {id, name, icon, persons[], days[], start, end, location, bring, every_weeks, first, season_from, season_to, pause_holidays}
    "holidays": [],    # {id, name, from, to}
}

# Aktionen, die nur mit gültiger Entsperrung (Eltern-PIN) erlaubt sind
PROTECTED = {"approve", "reject", "adjust_points", "save_item", "delete_item", "notify_test"}
# Einstellungen, die jede Person ohne PIN ändern darf
FREE_SETTINGS = {"theme"}

MAX_HISTORY = 200
EVENTS_CACHE_SECONDS = 300
PERSON_TAG = "[fz:"
MAX_LEDGER = 2000


def _uid() -> str:
    return uuid.uuid4().hex[:10]


def _now_iso() -> str:
    return dt_util.now().replace(microsecond=0).isoformat()


def _hash_pin(pin: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), PIN_ITERATIONS).hex()


class FamilienzentraleHub:
    """Hält die Daten und führt alle Aktionen des Panels aus."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self._store: Store[dict[str, Any]] = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data: dict[str, Any] = copy.deepcopy(DEFAULT_DATA)
        self._listeners: list[Callable[[], None]] = []
        self._tokens: dict[str, float] = {}
        self.mealie = MealieBridge(hass)
        # Kürzlich an die Einkaufsliste geschickte Artikel. Bring meldet neue Einträge
        # erst mit Verzögerung zurück; so entstehen bei mehrfachem Senden keine Doppel.
        self._recent_added: dict[str, float] = {}
        self.photos = photos.PhotoLibrary()
        # Termine zwischenspeichern: Kalender (z. B. Google) nicht bei jeder Aktion neu abfragen
        self._events_cache: dict[str, Any] = {"ts": 0.0, "data": []}

    # ---------- Laden / Speichern ----------
    async def async_load(self) -> None:
        stored = await self._store.async_load()
        if stored:
            data = copy.deepcopy(DEFAULT_DATA)
            data.update(stored)
            # neue Einstellungs-Schlüssel aus späteren Versionen ergänzen
            settings = copy.deepcopy(DEFAULT_DATA["settings"])
            for key, val in (stored.get("settings") or {}).items():
                if isinstance(val, dict) and isinstance(settings.get(key), dict):
                    settings[key].update(val)
                else:
                    settings[key] = val
            data["settings"] = settings
            n = settings["notify"]
            old_tg = n.pop("telegram", None)
            n.pop("waste_targets", None)
            if old_tg and old_tg not in n.get("targets", []):
                n.setdefault("targets", []).append(old_tg)
            ev = copy.deepcopy(DEFAULT_DATA["settings"]["notify"]["events"])
            for k, v in (n.get("events") or {}).items():
                if isinstance(v, dict) and k in ev:
                    ev[k].update(v)
            n["events"] = ev
            self.data = data
            if logic.migrate(self.data):
                _LOGGER.info("Routinen und Aufgaben ins neue Format übernommen")
                self._save()

    @callback
    def _save(self) -> None:
        self._store.async_delay_save(lambda: self.data, 1)

    @callback
    def async_add_listener(self, cb: Callable[[], None]) -> Callable[[], None]:
        self._listeners.append(cb)

        @callback
        def _remove() -> None:
            if cb in self._listeners:
                self._listeners.remove(cb)

        return _remove

    @callback
    def async_notify(self) -> None:
        for cb in list(self._listeners):
            try:
                cb()
            except Exception:  # noqa: BLE001 - ein defekter Zuhörer darf die anderen nicht stoppen
                _LOGGER.exception("Fehler beim Benachrichtigen")

    @callback
    def _changed(self) -> None:
        self._save()
        self.async_notify()

    # ---------- Hilfen ----------
    def today(self) -> date:
        return dt_util.now().date()

    def _find(self, col: str, item_id: str | None) -> dict | None:
        for item in self.data.get(col, []):
            if item.get("id") == item_id:
                return item
        return None

    def _book(self, person: str, delta: int, reason: str, ref: dict | None = None) -> dict:
        entry = {"id": _uid(), "person": person, "delta": int(delta), "reason": reason, "ts": _now_iso()}
        if ref:
            entry["src"] = dict(ref)
        self.data["ledger"].append(entry)
        if len(self.data["ledger"]) > MAX_LEDGER:
            # Älteste Buchungen zusammenfassen, damit der Stand stimmt
            old = self.data["ledger"][:-MAX_LEDGER]
            self.data["ledger"] = self.data["ledger"][-MAX_LEDGER:]
            sums: dict[str, int] = {}
            for l in old:
                sums[l["person"]] = sums.get(l["person"], 0) + int(l["delta"])
            for pid, s in sums.items():
                self.data["ledger"].insert(0, {"id": _uid(), "person": pid, "delta": s, "reason": "Übertrag", "ts": old[-1]["ts"]})
        return entry

    def _history(self, kind: str, name: str, person: str | None) -> None:
        self.data["history"].insert(0, {"id": _uid(), "kind": kind, "name": name, "person": person, "ts": _now_iso()})
        del self.data["history"][MAX_HISTORY:]

    def _credit(self, person: dict, pts: int, name: str, approval: bool, ref: dict) -> None:
        if not pts or not person.get("points_enabled"):
            return
        if approval:
            self.data["pending"].append({"id": _uid(), "kind": "aufgabe", "name": name, "person": person["id"], "points": pts, "ts": _now_iso(), **ref})
        else:
            self._book(person["id"], pts, name, ref)

    def _uncredit(self, pid: str | None, pts: int, name: str, ref: dict) -> None:
        if not pid:
            return
        today = self.today().isoformat()
        for i, h in enumerate(self.data["history"]):
            if h.get("person") == pid and h.get("name") == name and str(h.get("ts", ""))[:10] == today:
                del self.data["history"][i]
                break
        match = [x for x in self.data["pending"] if x.get("person") == pid and all(x.get(k) == v for k, v in ref.items())]
        if match:
            self.data["pending"] = [x for x in self.data["pending"] if x is not match[0]]
            return
        # Nur zurückbuchen, was für genau diesen Haken auch gutgeschrieben wurde
        for entry in reversed(self.data["ledger"]):
            src = entry.get("src") or {}
            if entry.get("person") == pid and entry.get("delta", 0) > 0 and not entry.get("undone") and all(src.get(k) == v for k, v in ref.items()):
                entry["undone"] = True
                self._book(pid, -int(entry["delta"]), "↩︎ " + name)
                return

    # ---------- PIN ----------
    @property
    def pin_set(self) -> bool:
        return bool(self.data["settings"].get("pin"))

    async def async_check_pin(self, pin: str) -> bool:
        stored = self.data["settings"].get("pin")
        if not stored:
            return True
        calc = await self.hass.async_add_executor_job(_hash_pin, str(pin), stored["salt"])
        return secrets.compare_digest(calc, stored["hash"])

    def _new_token(self) -> str:
        now = time.monotonic()
        self._tokens = {t: exp for t, exp in self._tokens.items() if exp > now}
        token = secrets.token_hex(16)
        self._tokens[token] = now + PIN_UNLOCK_SECONDS
        return token

    def _token_ok(self, token: str | None) -> bool:
        if not self.pin_set:
            return True
        return bool(token) and self._tokens.get(token, 0) > time.monotonic()

    # ---------- Zustand für das Panel ----------
    async def async_state(self) -> dict[str, Any]:
        st = copy.deepcopy(self.data)
        st["settings"]["pin_set"] = self.pin_set
        st["settings"].pop("pin", None)
        if time.monotonic() - self._events_cache["ts"] > EVENTS_CACHE_SECONDS:
            self._events_cache = {"ts": time.monotonic(), "data": await self._async_events()}
        st["events"] = self._events_cache["data"]
        st["shopping"] = self._shopping_items()
        st["todo_lists"] = self._entities_of("todo")
        st["calendar_list"] = self._entities_of("calendar")
        st["ha_persons"] = self._entities_of("person")
        st["recipes"] = []
        st["version"] = VERSION
        st["notify_targets"] = notifier.targets(self.hass)
        st["speakers"] = [x for x in self._entities_of("media_player") if x.get("platform") in ("sonos", None)] or self._entities_of("media_player")
        st["tts_list"] = self._entities_of("tts")
        st.pop("notify_log", None)
        st["mealie"] = {"ok": False, "error": None}
        if self.mealie.available:
            ws = self.today() - timedelta(days=self.today().weekday())
            meals = await self.mealie.async_meals(ws, ws + timedelta(days=13))
            st["mealie"] = {"ok": self.mealie.error is None, "error": self.mealie.error}
            if self.mealie.error is None:
                st["meals"] = copy.deepcopy(meals)
        # Personenzahl je Gericht ergänzen
        for key, n in (self.data.get("meal_servings") or {}).items():
            day, _, slot = key.partition("|")
            meal = (st["meals"].get(day) or {}).get(slot)
            if meal:
                meal["servings"] = n
        return st

    def _entities_of(self, domain: str) -> list[dict[str, Any]]:
        reg = er.async_get(self.hass)
        out = []
        for state in self.hass.states.async_all(domain):
            ent = reg.async_get(state.entity_id)
            out.append(
                {
                    "entity_id": state.entity_id,
                    "name": state.attributes.get("friendly_name") or state.entity_id,
                    "platform": ent.platform if ent else None,
                }
            )
        return sorted(out, key=lambda x: x["name"].lower())

    def _component_entity(self, domain: str, entity_id: str | None) -> Any:
        if not entity_id:
            return None
        component = self.hass.data.get(domain)
        if component is None or not hasattr(component, "get_entity"):
            return None
        return component.get_entity(entity_id)

    # ---------- Kalender ----------
    def _calendar_map(self) -> dict[str, str | None]:
        """entity_id -> Person-ID (None = Familie)."""
        m: dict[str, str | None] = {}
        fam = self.data["settings"].get("family_calendar")
        if fam:
            m[fam] = None
        for p in self.data["persons"]:
            if p.get("calendar"):
                m[p["calendar"]] = p["id"]
        return m

    def _cal_features(self, entity_id: str) -> int:
        state = self.hass.states.get(entity_id)
        try:
            return int((state.attributes if state else {}).get("supported_features") or 0)
        except (TypeError, ValueError):
            return 0

    def _modes(self, entity_id: str) -> tuple[str | None, str | None]:
        """(Löschen, Bearbeiten): "entity" = offizielle HA-Funktion, "caldav" = über die CalDAV-Verbindung."""
        feats = self._cal_features(entity_id)
        caldav = None
        if self._platform(entity_id) == "caldav" and caldav_edit.available(self._component_entity("calendar", entity_id)):
            caldav = "caldav"
        return ("entity" if feats & 2 else caldav), ("entity" if feats & 4 else caldav)

    def _platform(self, entity_id: str) -> str | None:
        ent = er.async_get(self.hass).async_get(entity_id)
        return ent.platform if ent else None

    async def _async_events(self) -> list[dict[str, Any]]:
        start = dt_util.start_of_local_day() - timedelta(days=CAL_DAYS_BACK)
        end = dt_util.start_of_local_day() + timedelta(days=CAL_DAYS_AHEAD)
        events: list[dict[str, Any]] = []
        for entity_id, person in self._calendar_map().items():
            ent = self._component_entity("calendar", entity_id)
            if ent is None:
                continue
            try:
                items = await ent.async_get_events(self.hass, start, end)
            except Exception:  # noqa: BLE001 - ein defekter Kalender darf die Seite nicht blockieren
                _LOGGER.warning("Termine aus %s konnten nicht gelesen werden", entity_id, exc_info=True)
                continue
            del_mode, edit_mode = self._modes(entity_id)
            for ev in items:
                allday = not isinstance(ev.start, datetime)
                who = person
                desc = getattr(ev, "description", None) or ""
                if PERSON_TAG in desc:
                    tagged = desc.split(PERSON_TAG, 1)[1].split("]", 1)[0].strip()
                    if self._find("persons", tagged):
                        who = tagged
                events.append(
                    {
                        "id": f"{entity_id}|{ev.uid or ''}|{ev.start}",
                        "calendar": entity_id,
                        "uid": ev.uid,
                        "person": who,
                        "title": ev.summary,
                        "location": ev.location,
                        "allday": allday,
                        "start": ev.start.isoformat() if allday else dt_util.as_local(ev.start).replace(tzinfo=None).isoformat(),
                        "end": ev.end.isoformat() if allday else dt_util.as_local(ev.end).replace(tzinfo=None).isoformat(),
                        "rrule": getattr(ev, "rrule", None),
                        "recurrence_id": getattr(ev, "recurrence_id", None),
                        "can_delete": del_mode is not None,
                        "can_edit": edit_mode is not None,
                        "edit_mode": edit_mode,
                        "description": desc.split(PERSON_TAG, 1)[0].strip() if PERSON_TAG in desc else desc,
                    }
                )
        events.sort(key=lambda e: e["start"])
        return events

    async def _async_add_event(self, d: dict) -> None:
        person = d.get("person")
        target = None
        if person:
            p = self._find("persons", person)
            target = p.get("calendar") if p else None
        tag_person = person if (person and not target) else None
        target = target or self.data["settings"].get("family_calendar")
        if not target:
            raise HomeAssistantError("Kein Kalender gewählt (Einstellungen → Kalender)")
        data: dict[str, Any] = {"summary": d.get("title") or "Termin"}
        if tag_person:
            # Person ohne eigenen Kalender: Termin im Familienkalender, Person in der Beschreibung merken
            p = self._find("persons", tag_person)
            data["description"] = f"Für {p.get('name') if p else ''} {PERSON_TAG}{tag_person}]"
        rrule = str(d.get("rrule") or "").strip()
        if rrule:
            # Serientermin: direkt über die Kalender-Entität (die Aktion calendar.create_event kennt keine Wiederholung)
            ent = self._component_entity("calendar", target)
            if ent is None or not hasattr(ent, "async_create_event"):
                raise HomeAssistantError("Dieser Kalender kann keine Termine anlegen")
            kw: dict[str, Any] = {"summary": data["summary"], "rrule": rrule_for_platform(rrule, self._platform(target))}
            if data.get("description"):
                kw["description"] = data["description"]
            if d.get("allday"):
                kw["dtstart"] = date.fromisoformat(str(d["start"])[:10])
                kw["dtend"] = date.fromisoformat(str(d["end"])[:10])
            else:
                kw["dtstart"] = dt_util.as_local(datetime.fromisoformat(str(d["start"])).replace(tzinfo=dt_util.now().tzinfo))
                kw["dtend"] = dt_util.as_local(datetime.fromisoformat(str(d["end"])).replace(tzinfo=dt_util.now().tzinfo))
            try:
                await ent.async_create_event(**kw)
            except HomeAssistantError:
                raise
            except Exception as err:  # noqa: BLE001
                raise HomeAssistantError(f"Serientermin nicht möglich in diesem Kalender: {err}") from err
            return
        if d.get("allday"):
            data["start_date"] = str(d["start"])[:10]
            data["end_date"] = str(d["end"])[:10]
        else:
            data["start_date_time"] = str(d["start"])
            data["end_date_time"] = str(d["end"])
        await self.hass.services.async_call("calendar", "create_event", data, target={"entity_id": target}, blocking=True)

    async def _async_delete_event(self, event_id: str, recurrence_id: str | None = None, scope: str = "all") -> None:
        entity_id, uid, _ = (event_id.split("|") + ["", "", ""])[:3]
        ent = self._component_entity("calendar", entity_id)
        del_mode = self._modes(entity_id)[0] if ent is not None else None
        if ent is None or not uid or del_mode is None:
            raise HomeAssistantError("Dieser Kalender erlaubt Home Assistant kein Löschen – bitte in der Kalender-App löschen")
        if del_mode == "caldav":
            try:
                await self.hass.async_add_executor_job(caldav_edit.delete, ent, uid, recurrence_id if scope == "one" else None, recurrence_id or (event_id.split("|") + ["", "", ""])[2])
            except Exception as err:  # noqa: BLE001
                raise HomeAssistantError(f"Löschen im CalDAV-Kalender fehlgeschlagen: {err}") from err
            return
        if scope == "one" and recurrence_id:
            await ent.async_delete_event(uid, recurrence_id=recurrence_id)
        elif scope == "future" and recurrence_id:
            await ent.async_delete_event(uid, recurrence_id=recurrence_id, recurrence_range="THISANDFUTURE")
        else:
            await ent.async_delete_event(uid)

    def _target_for(self, person: str | None) -> tuple[str | None, str | None]:
        """(Kalender, Person für Markierung) – Person ohne eigenen Kalender kommt in den Familienkalender."""
        target = None
        if person:
            p = self._find("persons", person)
            target = p.get("calendar") if p else None
        tag = person if (person and not target) else None
        return target or self.data["settings"].get("family_calendar"), tag

    def _description(self, base: str | None, tag_person: str | None) -> str | None:
        base = (base or "").split(PERSON_TAG, 1)[0].strip()
        if base.startswith("Für ") and "\n" not in base and len(base) < 60:
            base = ""  # alte automatische Markierung „Für …“
        if tag_person:
            p = self._find("persons", tag_person)
            tag = f"Für {p.get('name') if p else ''} {PERSON_TAG}{tag_person}]"
            return f"{base}\n{tag}" if base else tag
        return base or None

    @staticmethod
    def _when(d: dict) -> tuple[Any, Any]:
        if d.get("allday"):
            return date.fromisoformat(str(d["start"])[:10]), date.fromisoformat(str(d["end"])[:10])
        tz = dt_util.now().tzinfo
        return datetime.fromisoformat(str(d["start"])).replace(tzinfo=tz), datetime.fromisoformat(str(d["end"])).replace(tzinfo=tz)

    async def _async_update_event(self, d: dict) -> None:
        entity_id, uid, _ = (str(d.get("id", "")).split("|") + ["", "", ""])[:3]
        ent = self._component_entity("calendar", entity_id)
        if ent is None or not uid:
            raise HomeAssistantError("Termin nicht gefunden")
        new_target, tag = self._target_for(d.get("person"))
        rid = d.get("recurrence_id")
        scope = str(d.get("scope") or "one")
        start, end = self._when(d)
        if new_target and new_target != entity_id:
            # andere Person mit eigenem Kalender: neu anlegen, alten Termin entfernen
            if rid and scope != "one":
                raise HomeAssistantError("Eine ganze Serie kann nicht in einen anderen Kalender verschoben werden")
            if self._modes(entity_id)[0] is None:
                raise HomeAssistantError("Der alte Termin kann in diesem Kalender nicht gelöscht werden – Person bitte in der Kalender-App ändern")
            await self._async_add_event({"title": d.get("title"), "person": d.get("person"), "allday": d.get("allday"), "start": d["start"], "end": d["end"]})
            await self._async_delete_event(str(d["id"]), rid, "one" if rid else "all")
            return
        edit_mode = self._modes(entity_id)[1]
        if edit_mode is None:
            raise HomeAssistantError("Dieser Kalender erlaubt Home Assistant kein Bearbeiten – bitte in der Kalender-App ändern")
        changes: dict[str, Any] = {"summary": d.get("title") or "Termin", "dtstart": start, "dtend": end,
                                   "description": self._description(d.get("description"), tag)}
        if edit_mode == "caldav":
            try:
                await self.hass.async_add_executor_job(caldav_edit.update, ent, uid, changes, rid, scope != "one", rid or (str(d.get("id", "")).split("|") + ["", "", ""])[2])
            except Exception as err:  # noqa: BLE001
                raise HomeAssistantError(f"Ändern im CalDAV-Kalender fehlgeschlagen: {err}") from err
            return
        event = {k: v for k, v in changes.items() if v is not None}
        if rid and scope != "one":
            await ent.async_update_event(uid, event, recurrence_id=rid, recurrence_range="THISANDFUTURE")
        else:
            await ent.async_update_event(uid, event, recurrence_id=rid)

    # ---------- Einkauf (To-do-Liste, z. B. Bring) ----------
    def _shopping_list(self) -> str:
        return self.data["settings"]["mealie"].get("bring_list") or ""

    def _shopping_items(self) -> list[dict[str, Any]]:
        ent = self._component_entity("todo", self._shopping_list())
        if ent is None:
            return []
        items = ent.todo_items or []
        return [
            {"uid": i.uid, "summary": i.summary, "status": str(getattr(i.status, "value", i.status))}
            for i in items
            if str(getattr(i.status, "value", i.status)) != "completed"
        ]

    async def _async_shopping_add(self, items: list[Any]) -> int:
        target = self._shopping_list()
        if not target:
            raise HomeAssistantError("Keine Einkaufsliste gewählt (Einstellungen → Mealie & Bring)")
        now = time.monotonic()
        self._recent_added = {k: v for k, v in self._recent_added.items() if now - v < 900}
        have = {norm(i["summary"]) for i in self._shopping_items()} | set(self._recent_added)
        added = 0
        for it in items:
            spec = ""
            if isinstance(it, dict):
                name, spec = str(it.get("name") or "").strip(), str(it.get("spec") or "").strip()
            else:
                name = str(it).strip()
            if not name or norm(name) in have:
                continue
            payload = {"item": name}
            if spec:
                payload["description"] = spec
            await self.hass.services.async_call("todo", "add_item", payload, target={"entity_id": target}, blocking=True)
            have.add(norm(name))
            self._recent_added[norm(name)] = time.monotonic()
            added += 1
        return added

    # ---------- Aktionen ----------
    async def async_action(self, action: str, data: dict[str, Any], user_name: str | None = None) -> dict[str, Any]:
        token = data.pop("_pin", None)
        if action in PROTECTED and not self._token_ok(token):
            raise HomeAssistantError("Eltern-PIN nötig")
        if action == "save_settings" and set(data) - FREE_SETTINGS and not self._token_ok(token):
            raise HomeAssistantError("Eltern-PIN nötig")
        if action in ("add_event", "delete_event", "update_event") and self.data["settings"].get("lock_calendar") and not self._token_ok(token):
            raise HomeAssistantError("Eltern-PIN nötig")

        d = self.data
        today = self.today()
        t = today.isoformat()
        result: dict[str, Any] = {}
        pending_before = {x.get("id") for x in d["pending"]}

        if action == "check_pin":
            ok = await self.async_check_pin(str(data.get("pin", "")))
            return {"ok": ok, "token": self._new_token() if ok else None}

        if action == "complete_task":
            task = self._find("tasks", data.get("task"))
            person = self._find("persons", data.get("person"))
            if not task or not person:
                raise HomeAssistantError("Aufgabe oder Person nicht gefunden")
            key = logic.task_key(task, person["id"])
            task.setdefault("done", {})[key] = t
            task["last_by"] = person["id"]
            if logic.task_mode(task) == "reihum":
                task["rotate_index"] = int(task.get("rotate_index") or 0) + 1
            self._history("aufgabe", task.get("name", ""), person["id"])
            pts = int(task.get("points") or 0)
            self._credit(person, pts, task.get("name", ""), bool(task.get("needs_approval")), {"ref": task["id"], "date": t})
            self.hass.bus.async_fire(EVENT_TASK_DONE, {"task": task.get("name"), "person": person.get("name"), "points": pts})

        elif action == "undo_task":
            task = self._find("tasks", data.get("task"))
            pid = data.get("person")
            if task:
                key = logic.task_key(task, pid)
                if (task.get("done") or {}).get(key) == t:
                    who = pid if logic.task_mode(task) == "jeder" else task.get("last_by")
                    task["done"].pop(key, None)
                    if logic.task_mode(task) == "reihum":
                        task["rotate_index"] = max(0, int(task.get("rotate_index") or 0) - 1)
                    self._uncredit(who, int(task.get("points") or 0), task.get("name", ""), {"ref": task["id"], "date": t})

        elif action in ("complete_step", "undo_step"):
            r = self._find("routines", data.get("routine"))
            person = self._find("persons", data.get("person"))
            if not r or not person:
                raise HomeAssistantError("Routine oder Person nicht gefunden")
            step_id = data.get("step") or "*"
            step = next((x for x in r.get("steps") or [] if x.get("id") == step_id), None)
            name = (r.get("name", "") + " · " + step.get("name", "")) if step else r.get("name", "")
            pts = int((step or r).get("points") or 0)
            rec = r.setdefault("done", {}).get(person["id"]) or {}
            steps_done = list(rec.get("steps") or []) if rec.get("date") == t else []
            ref = {"ref": r["id"], "step": step_id, "date": t}
            if action == "complete_step":
                if step_id in steps_done:
                    return result
                steps_done.append(step_id)
                self._history("routine", name, person["id"])
                self._credit(person, pts, name, bool(r.get("needs_approval")), ref)
                self.hass.bus.async_fire(EVENT_TASK_DONE, {"task": name, "person": person.get("name"), "points": pts, "routine": r.get("name")})
            else:
                if step_id not in steps_done:
                    return result
                steps_done.remove(step_id)
                self._uncredit(person["id"], pts, name, ref)
            r["done"][person["id"]] = {"date": t, "steps": steps_done}

        elif action == "redeem":
            rw = self._find("rewards", data.get("reward"))
            person = self._find("persons", data.get("person"))
            if not rw or not person:
                raise HomeAssistantError("Belohnung oder Person nicht gefunden")
            cost = int(rw.get("cost") or 0)
            if logic.available(d, person["id"]) < cost:
                raise HomeAssistantError("Nicht genug Punkte")
            if rw.get("needs_approval"):
                d["pending"].append({"id": _uid(), "kind": "belohnung", "ref": rw["id"], "name": rw.get("name"), "person": person["id"], "points": -cost, "ts": _now_iso()})
            else:
                self._book(person["id"], -cost, "🎁 " + rw.get("name", ""))
                self.hass.bus.async_fire(EVENT_REWARD_REDEEMED, {"reward": rw.get("name"), "person": person.get("name")})

        elif action == "approve":
            pe = next((x for x in d["pending"] if x.get("id") == data.get("id")), None)
            if pe:
                ref = {k: pe[k] for k in ("ref", "step", "date") if k in pe} if pe["kind"] == "aufgabe" else None
                self._book(pe["person"], int(pe["points"]), ("🎁 " if pe["kind"] == "belohnung" else "") + str(pe.get("name")), ref)
                d["pending"] = [x for x in d["pending"] if x is not pe]
                if pe["kind"] == "belohnung":
                    p = self._find("persons", pe["person"])
                    self.hass.bus.async_fire(EVENT_REWARD_REDEEMED, {"reward": pe.get("name"), "person": p.get("name") if p else None})

        elif action == "reject":
            pe = next((x for x in d["pending"] if x.get("id") == data.get("id")), None)
            d["pending"] = [x for x in d["pending"] if x is not pe]
            if pe and pe.get("kind") == "aufgabe" and pe.get("date") == t:
                if pe.get("step"):
                    r = self._find("routines", pe.get("ref"))
                    rec = (r or {}).get("done", {}).get(pe["person"])
                    if rec and rec.get("date") == t:
                        rec["steps"] = [x for x in rec.get("steps", []) if x != pe["step"]]
                else:
                    task = self._find("tasks", pe.get("ref"))
                    if task:
                        task.setdefault("done", {}).pop(logic.task_key(task, pe["person"]), None)
                        if logic.task_mode(task) == "reihum":
                            task["rotate_index"] = max(0, int(task.get("rotate_index") or 0) - 1)

        elif action == "adjust_points":
            if not self._find("persons", data.get("person")):
                raise HomeAssistantError("Person nicht gefunden")
            self._book(data["person"], int(data.get("delta") or 0), str(data.get("reason") or "Korrektur"))

        elif action == "save_item":
            col = data.get("collection")
            if col == "persons":
                self.invalidate_events()
            item = data.get("item")
            if col not in COLLECTIONS or not isinstance(item, dict):
                raise HomeAssistantError("Ungültige Daten")
            if not item.get("id"):
                item["id"] = _uid()
                d[col].append(item)
            else:
                cur = self._find(col, item["id"])
                if cur is None:
                    d[col].append(item)
                else:
                    cur.update(item)

        elif action == "delete_item":
            col = data.get("collection")
            if col not in COLLECTIONS:
                raise HomeAssistantError("Ungültige Daten")
            d[col] = [x for x in d[col] if x.get("id") != data.get("id")]

        elif action == "save_settings":
            if "family_calendar" in data:
                self.invalidate_events()
            for key, val in data.items():
                if key == "new_pin":
                    pin = str(val or "")
                    if not (pin.isdigit() and len(pin) == 4):
                        raise HomeAssistantError("Die PIN muss 4 Ziffern haben")
                    salt = secrets.token_hex(16)
                    d["settings"]["pin"] = {"salt": salt, "hash": await self.hass.async_add_executor_job(_hash_pin, pin, salt)}
                    self._tokens.clear()
                elif key in ("pin", "pin_set"):
                    continue
                else:
                    d["settings"][key] = val

        elif action == "maint_done":
            m = self._find("maintenance", data.get("id"))
            if not m:
                raise HomeAssistantError("Wartung nicht gefunden")
            m["last"] = t
            m["next"] = logic.add_interval(today, m.get("every"), m.get("unit")).isoformat()
            m.setdefault("history", []).insert(0, {"person": data.get("person"), "ts": _now_iso()})
            del m["history"][50:]
            self._history("wartung", m.get("name", ""), data.get("person"))
            p = self._find("persons", data.get("person"))
            self.hass.bus.async_fire(EVENT_MAINT_DONE, {"name": m.get("name"), "person": p.get("name") if p else None})

        elif action == "add_event":
            await self._async_add_event(data)
            self.invalidate_events()

        elif action == "update_event":
            await self._async_update_event(data)
            self.invalidate_events()

        elif action == "delete_event":
            await self._async_delete_event(str(data.get("id", "")), data.get("recurrence_id"), str(data.get("scope") or "all"))
            self.invalidate_events()

        elif action == "shopping_add":
            result["added"] = await self._async_shopping_add([str(data.get("summary", ""))])

        elif action == "shopping_done":
            done_name = next((i["summary"] for i in self._shopping_items() if i["uid"] == data.get("uid")), None)
            if done_name:
                self._recent_added.pop(norm(done_name), None)
            target = self._shopping_list()
            if target:
                await self.hass.services.async_call("todo", "update_item", {"item": data.get("uid"), "status": "completed"}, target={"entity_id": target}, blocking=True)

        elif action == "send_to_bring":
            result["added"] = await self._async_shopping_add([x if isinstance(x, dict) else str(x) for x in data.get("items") or []])

        elif action == "set_meal":
            day, slot, meal = str(data.get("date")), str(data.get("slot")), data.get("meal")
            if self.mealie.available:
                if meal and meal.get("recipe") and not meal.get("recipe_id"):
                    # ältere Oberfläche schickt nur den Rezept-Slug: ID in Mealie nachschlagen
                    meal["recipe_id"] = await self.mealie.async_recipe_id(str(meal["recipe"]))
                ws = today - timedelta(days=today.weekday())
                cur = (await self.mealie.async_meals(ws, ws + timedelta(days=13))).get(day, {}).get(slot)
                await self.mealie.async_set_meal(day, slot, meal, cur)
            else:
                d["meals"].setdefault(day, {})[slot] = meal
                self._prune_meals(today)
            if not meal:
                d.setdefault("meal_servings", {}).pop(f"{day}|{slot}", None)
            if meal and meal.get("recipe_id") and d["settings"]["mealie"].get("to_bring") == "auto" and self.mealie.available:
                n = (d.get("meal_servings") or {}).get(f"{day}|{slot}") or d["settings"]["mealie"].get("servings")
                result["added"] = await self._async_shopping_add(await self.mealie.async_ingredients([(meal["recipe_id"], n)]))

        elif action == "noop":
            pass

        elif action == "set_servings":
            key = f"{data.get('date')}|{data.get('slot')}"
            n = int(data.get("servings") or 0)
            if n > 0:
                d.setdefault("meal_servings", {})[key] = min(n, 50)
            else:
                d.setdefault("meal_servings", {}).pop(key, None)

        elif action == "search_recipes":
            if not self.mealie.available:
                return {"recipes": [], "error": "Mealie ist in Home Assistant nicht eingerichtet"}
            return {"recipes": await self.mealie.async_search(str(data.get("query") or ""))}

        elif action == "recipe_ingredients":
            if not self.mealie.available:
                return {"items": []}
            ids: list[Any] = [str(x) for x in data.get("recipe_ids") or []]
            for name in data.get("names") or []:
                # Notiz mit dem Namen eines Rezepts: dieses Rezept verwenden
                rid = await self.mealie.async_find_by_name(str(name))
                if rid:
                    ids.append(rid)
            for e in data.get("entries") or []:
                rid = e.get("recipe_id") or (await self.mealie.async_find_by_name(str(e.get("name") or "")) if e.get("name") else None)
                if rid:
                    ids.append((str(rid), e.get("servings")))
            return {"items": await self.mealie.async_ingredients(ids, d["settings"]["mealie"].get("servings"))}

        elif action == "frame_photo":
            return await self._async_frame_photo(int(data.get("index") or 0))

        elif action == "notify_test":
            return await self._async_notify_test()

        else:
            raise HomeAssistantError(f"Unbekannte Aktion: {action}")

        new_pending = [x for x in d["pending"] if x.get("id") not in pending_before]
        if new_pending:
            self.hass.async_create_task(self._async_notify_pending(new_pending))
        self._changed()
        return result

    # ---------- Benachrichtigungen ----------
    def _nset(self) -> dict[str, Any]:
        return self.data["settings"]["notify"]

    def _quiet(self) -> bool:
        n = self._nset()
        return notifier.in_quiet(dt_util.now().strftime("%H:%M"), n.get("quiet_from"), n.get("quiet_to"))

    async def _async_send(self, event: str, title: str, message: str, speech: str | None = None,
                          actions: list[dict[str, str]] | None = None) -> list[dict[str, Any]]:
        n = self._nset()
        ev = (n.get("events") or {}).get(event, {})
        out: list[dict[str, Any]] = []
        if ev.get("push") and n.get("targets"):
            out += await notifier.send(self.hass, n["targets"], title, message, n.get("link") or None, actions)
        if ev.get("sonos") and n.get("sonos") and not self._quiet():
            out += await notifier.speak(self.hass, n["sonos"], n.get("tts"), speech or message, n.get("language"), n.get("volume"))
        return out

    def _pending_text(self, pe: dict) -> str:
        p = self._find("persons", pe.get("person")) or {}
        who = p.get("name") or "Jemand"
        if pe.get("kind") == "belohnung":
            return f"🎁 {who} möchte „{pe.get('name')}“ einlösen ({abs(int(pe.get('points') or 0))} ⭐)."
        pts = int(pe.get("points") or 0)
        return f"✅ {who} hat „{pe.get('name')}“ erledigt" + (f" (+{pts} ⭐)" if pts else "") + "."

    async def _async_notify_pending(self, items: list[dict]) -> None:
        for pe in items:
            actions = [{"action": notifier.ACTION_OK + str(pe["id"]), "title": "✅ Bestätigen"},
                       {"action": notifier.ACTION_NO + str(pe["id"]), "title": "✖️ Ablehnen", "destructive": "true"}]
            try:
                await self._async_send("approval", "🔔 Bitte bestätigen", self._pending_text(pe), actions=actions)
            except Exception:  # noqa: BLE001 - Benachrichtigung darf nie die Aktion stören
                _LOGGER.exception("Benachrichtigung „bitte bestätigen“ fehlgeschlagen")

    async def async_phone_action(self, action: str) -> None:
        """Knopf „Bestätigen“/„Ablehnen“ in der Handy-Nachricht."""
        if action.startswith(notifier.ACTION_OK):
            act, pid = "approve", action[len(notifier.ACTION_OK):]
        elif action.startswith(notifier.ACTION_NO):
            act, pid = "reject", action[len(notifier.ACTION_NO):]
        else:
            return
        if not any(x.get("id") == pid for x in self.data["pending"]):
            return  # schon erledigt (z. B. am Wand-iPad)
        # Die Nachricht ging nur an die eingestellten Eltern-Geräte; daher hier ohne PIN
        await self.async_action(act, {"id": pid, "_pin": self._new_token()})

    async def _async_notify_test(self) -> dict[str, Any]:
        n = self._nset()
        out = []
        if n.get("targets"):
            out += await notifier.send(self.hass, n["targets"], "Familienzentrale", "🔔 Testnachricht – das klappt!", n.get("link") or None)
        if n.get("sonos"):
            out += await notifier.speak(self.hass, n["sonos"], n.get("tts"), "Hallo, das ist eine Testansage der Familienzentrale.", n.get("language"), n.get("volume"))
        if not out:
            raise HomeAssistantError("Noch keine Empfänger oder Lautsprecher ausgewählt")
        return {"results": out}

    def _once(self, key: str, days: int = 1) -> bool:
        """True, wenn diese Erinnerung in den letzten `days` Tagen noch nicht kam (und merkt sie sich)."""
        log = self.data.setdefault("notify_log", {})
        today = self.today()
        last = log.get(key)
        if last and (today - date.fromisoformat(last)).days < days:
            return False
        log[key] = today.isoformat()
        cutoff = (today - timedelta(days=40)).isoformat()
        for k in [k for k, v in log.items() if v < cutoff]:
            log.pop(k, None)
        self._save()
        return True

    async def async_tick_minute(self) -> None:
        """Jede Minute: geplante Erinnerungen (Müll am Vorabend, Wartung)."""
        n = self._nset()
        hm = dt_util.now().strftime("%H:%M")
        today = self.today()
        try:
            if hm == (n.get("waste_time") or "19:00") and self.data["settings"]["modules"].get("muell") is not False:
                tomorrow = today + timedelta(days=1)
                names = [w.get("name") for w in self.data.get("waste", []) if logic.waste_dates(w, 1, tomorrow)[:1] == [tomorrow]]
                if names and self._once("waste:" + tomorrow.isoformat()):
                    txt = ", ".join(str(x) for x in names)
                    await self._async_send("waste", "🗑️ Morgen Abfuhr", f"Morgen wird abgeholt: {txt}. Bitte heute bereitstellen.",
                                           speech=f"Erinnerung: Morgen wird abgeholt: {txt}. Bitte heute Abend bereitstellen.")
            if hm == (n.get("maint_time") or "08:00") and self.data["settings"]["modules"].get("wartung") is not False:
                due = [m for m in self.data.get("maintenance", []) if logic.maint_status(m, today) != "ok" and m.get("next") and m["next"] <= today.isoformat()]
                due = [m for m in due if self._once("maint:" + str(m.get("id")), 7)]
                if due:
                    txt = ", ".join(str(m.get("name")) for m in due)
                    await self._async_send("maintenance", "🔧 Wartung fällig", f"Fällig: {txt}.", speech=f"Wartung fällig: {txt}.")
        except Exception:  # noqa: BLE001
            _LOGGER.exception("Geplante Erinnerung fehlgeschlagen")

    # ---------- Bilderrahmen ----------
    async def _async_frame_photo(self, index: int) -> dict[str, Any]:
        """Signierte Adresse für das Foto Nummer index (läuft endlos im Kreis)."""
        media_root = (getattr(self.hass.config, "media_dirs", None) or {}).get("local") or "/media"
        setting = self.data["settings"].get("frame", {}).get("media")
        folder = photos.folder_of(setting, media_root)
        if folder is None:
            raise HomeAssistantError("Bilderrahmen: bitte unter Einstellungen den Medienordner eintragen (z. B. Bilder)")
        lib = self.photos
        if lib.needs_scan(folder):
            if not await self.hass.async_add_executor_job(folder.is_dir):
                raise HomeAssistantError(f"Bilderrahmen: Ordner „{setting}“ nicht gefunden")
            lib.set_files(folder, await self.hass.async_add_executor_job(photos.scan, folder))
        if not lib.count:
            raise HomeAssistantError(f"Bilderrahmen: keine Fotos in „{setting}“")
        i = index % lib.count
        return {"url": self._sign(f"/api/familienzentrale/foto/{i}?g={lib.generation}"), "count": lib.count, "album": lib.name(i)}

    def _sign(self, path: str) -> str:
        try:
            from homeassistant.components.http.auth import async_sign_path
        except ImportError:  # Testumgebung
            return path
        return async_sign_path(self.hass, path, timedelta(minutes=30))

    @callback
    def invalidate_events(self) -> None:
        self._events_cache["ts"] = 0.0

    def _prune_meals(self, today: date) -> None:
        limit = (today - timedelta(days=30)).isoformat()
        for key in [k for k in self.data["meals"] if k < limit]:
            del self.data["meals"][key]

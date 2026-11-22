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
from .mealie import MealieBridge
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
            "telegram": "",
            "sonos": [],
            "quiet_from": "21:00",
            "quiet_to": "07:00",
            "waste_time": "19:00",
            "waste_targets": ["telegram", "sonos"],
        },
        "mealie": {"to_bring": "button", "bring_list": "", "slots": ["fruehstueck", "mittag", "abend"]},
        "pin": None,  # {"salt": ..., "hash": ...}
    },
    "persons": [],
    "tasks": [],
    "routines": [],
    "rewards": [],
    "ledger": [],
    "pending": [],
    "history": [],
    "maintenance": [],
    "waste": [],
    "meals": {},
}

# Aktionen, die nur mit gültiger Entsperrung (Eltern-PIN) erlaubt sind
PROTECTED = {"approve", "reject", "adjust_points", "save_item", "delete_item"}
# Einstellungen, die jede Person ohne PIN ändern darf
FREE_SETTINGS = {"theme"}

MAX_HISTORY = 200
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
        st["events"] = await self._async_events()
        st["shopping"] = self._shopping_items()
        st["todo_lists"] = self._entities_of("todo")
        st["calendar_list"] = self._entities_of("calendar")
        st["ha_persons"] = self._entities_of("person")
        st["recipes"] = []
        st["version"] = VERSION
        st["mealie"] = {"ok": False, "error": None}
        if self.mealie.available:
            ws = self.today() - timedelta(days=self.today().weekday())
            meals = await self.mealie.async_meals(ws, ws + timedelta(days=13))
            st["mealie"] = {"ok": self.mealie.error is None, "error": self.mealie.error}
            if self.mealie.error is None:
                st["meals"] = meals
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
        if d.get("allday"):
            data["start_date"] = str(d["start"])[:10]
            data["end_date"] = str(d["end"])[:10]
        else:
            data["start_date_time"] = str(d["start"])
            data["end_date_time"] = str(d["end"])
        await self.hass.services.async_call("calendar", "create_event", data, target={"entity_id": target}, blocking=True)

    async def _async_delete_event(self, event_id: str) -> None:
        entity_id, uid, _ = (event_id.split("|") + ["", "", ""])[:3]
        ent = self._component_entity("calendar", entity_id)
        if ent is None or not uid or not hasattr(ent, "async_delete_event"):
            raise HomeAssistantError("Dieser Termin kann hier nicht gelöscht werden")
        await ent.async_delete_event(uid)

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
        have = {i["summary"].strip().lower() for i in self._shopping_items()}
        added = 0
        for it in items:
            spec = ""
            if isinstance(it, dict):
                name, spec = str(it.get("name") or "").strip(), str(it.get("spec") or "").strip()
            else:
                name = str(it).strip()
            if not name or name.lower() in have:
                continue
            payload = {"item": name}
            if spec:
                payload["description"] = spec
            await self.hass.services.async_call("todo", "add_item", payload, target={"entity_id": target}, blocking=True)
            have.add(name.lower())
            added += 1
        return added

    # ---------- Aktionen ----------
    async def async_action(self, action: str, data: dict[str, Any], user_name: str | None = None) -> dict[str, Any]:
        token = data.pop("_pin", None)
        if action in PROTECTED and not self._token_ok(token):
            raise HomeAssistantError("Eltern-PIN nötig")
        if action == "save_settings" and set(data) - FREE_SETTINGS and not self._token_ok(token):
            raise HomeAssistantError("Eltern-PIN nötig")
        if action in ("add_event", "delete_event") and self.data["settings"].get("lock_calendar") and not self._token_ok(token):
            raise HomeAssistantError("Eltern-PIN nötig")

        d = self.data
        today = self.today()
        t = today.isoformat()
        result: dict[str, Any] = {}

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

        elif action == "delete_event":
            await self._async_delete_event(str(data.get("id", "")))

        elif action == "shopping_add":
            result["added"] = await self._async_shopping_add([str(data.get("summary", ""))])

        elif action == "shopping_done":
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
            if meal and meal.get("recipe_id") and d["settings"]["mealie"].get("to_bring") == "auto" and self.mealie.available:
                result["added"] = await self._async_shopping_add(await self.mealie.async_ingredients([meal["recipe_id"]]))

        elif action == "search_recipes":
            if not self.mealie.available:
                return {"recipes": [], "error": "Mealie ist in Home Assistant nicht eingerichtet"}
            return {"recipes": await self.mealie.async_search(str(data.get("query") or ""))}

        elif action == "recipe_ingredients":
            if not self.mealie.available:
                return {"items": []}
            ids = [str(x) for x in data.get("recipe_ids") or []]
            for name in data.get("names") or []:
                # Notiz mit dem Namen eines Rezepts: dieses Rezept verwenden
                rid = await self.mealie.async_find_by_name(str(name))
                if rid and rid not in ids:
                    ids.append(rid)
            return {"items": await self.mealie.async_ingredients(ids)}

        elif action == "frame_photo":
            raise HomeAssistantError("Bilderrahmen folgt in Etappe 5")

        else:
            raise HomeAssistantError(f"Unbekannte Aktion: {action}")

        self._changed()
        return result

    def _prune_meals(self, today: date) -> None:
        limit = (today - timedelta(days=30)).isoformat()
        for key in [k for k in self.data["meals"] if k < limit]:
            del self.data["meals"][key]

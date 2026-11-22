"""Lokaler Testserver: echtes Backend (hub.py) + echtes Panel, ohne Home Assistant.

Start:  python tests/dev_server.py [port]
Seite:  http://127.0.0.1:8770/tests/e2e.html

Home Assistant wird durch eine kleine Attrappe ersetzt (tests/fake_ha). Es gibt
Testkalender, eine Bring-ähnliche To-do-Liste und zwei HA-Personen.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import sys
import threading
import types
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests" / "fake_ha"))

# Paket "fz" zeigt auf die Integration, ohne deren __init__.py (braucht echtes HA) auszuführen
pkg = types.ModuleType("fz")
pkg.__path__ = [str(ROOT / "custom_components" / "familienzentrale")]
sys.modules["fz"] = pkg
hub_mod = importlib.import_module("fz.hub")
from homeassistant.exceptions import HomeAssistantError  # noqa: E402
from homeassistant.helpers import storage as fake_storage  # noqa: E402


class _Status:
    def __init__(self, v):
        self.value = v


class TodoItem:
    def __init__(self, uid, summary, status="needs_action"):
        self.uid, self.summary, self.status = uid, summary, _Status(status)


class FakeTodo:
    def __init__(self):
        self.todo_items: list[TodoItem] = []
        self._n = 0

    def add(self, summary):
        self._n += 1
        self.todo_items.append(TodoItem(f"u{self._n}", summary))


class CalEvent:
    def __init__(self, uid, summary, start, end, location=None, description=None, rrule=None, recurrence_id=None):
        self.uid, self.summary, self.start, self.end, self.location, self.description = uid, summary, start, end, location, description
        self.rrule, self.recurrence_id = rrule, recurrence_id
        self.exdates: set = set()


def _expand(ev, win_start, win_end):
    """Sehr einfache RRULE-Auflösung für Tests (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, BYDAY, COUNT, UNTIL)."""
    m = dict(x.split("=", 1) for x in ev.rrule.split(";") if "=" in x)
    n = int(m.get("INTERVAL", 1))
    days = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
    byday = [days.index(d) for d in m["BYDAY"].split(",")] if "BYDAY" in m else None
    s0 = ev.start
    d0 = s0.date() if isinstance(s0, datetime) else s0
    dur = ev.end - ev.start
    until = None
    if "UNTIL" in m:
        u = m["UNTIL"]
        until = date(int(u[:4]), int(u[4:6]), int(u[6:8]))
    count = int(m["COUNT"]) if "COUNT" in m else None
    out, k = [], 0
    for i in range(0, 800):
        d = d0 + timedelta(days=i)
        if until and d > until:
            break
        f = m.get("FREQ")
        if f == "DAILY":
            ok = i % n == 0
        elif f == "WEEKLY":
            wk = ((d - timedelta(days=d.weekday())) - (d0 - timedelta(days=d0.weekday()))).days // 7
            ok = d.weekday() in (byday or [d0.weekday()]) and wk % n == 0
        elif f == "MONTHLY":
            ok = d.day == d0.day
        else:
            ok = d.day == d0.day and d.month == d0.month
        if not ok:
            continue
        k += 1
        if count and k > count:
            break
        start = datetime.combine(d, s0.timetz()) if isinstance(s0, datetime) else d
        rid = start.strftime("%Y%m%dT%H%M%S") if isinstance(start, datetime) else start.strftime("%Y%m%d")
        if rid in ev.exdates:
            continue
        out.append(CalEvent(ev.uid, ev.summary, start, start + dur, ev.location, ev.description, ev.rrule, rid))
    return out


class FakeCalendar:
    def __init__(self):
        self.events: list[CalEvent] = []
        self._n = 0

    def add(self, summary, start, end, description=None, rrule=None):
        self._n += 1
        self.events.append(CalEvent(f"e{self._n}", summary, start, end, description=description, rrule=rrule))

    async def async_create_event(self, **kw):
        self.add(kw["summary"], kw["dtstart"], kw["dtend"], kw.get("description"), kw.get("rrule"))

    async def async_get_events(self, hass, start, end):
        def as_dt(x):
            return x if isinstance(x, datetime) else datetime(x.year, x.month, x.day).astimezone()

        res = []
        for e in self.events:
            for occ in (_expand(e, start, end) if e.rrule else [e]):
                if as_dt(occ.end) >= start and as_dt(occ.start) <= end:
                    res.append(occ)
        return res

    async def async_delete_event(self, uid, recurrence_id=None, recurrence_range=None):
        if recurrence_id:
            for e in self.events:
                if e.uid == uid:
                    e.exdates.add(recurrence_id)
            return
        self.events = [e for e in self.events if e.uid != uid]


class Component:
    def __init__(self):
        self.entities = {}

    def get_entity(self, entity_id):
        return self.entities.get(entity_id)


class State:
    def __init__(self, entity_id, name):
        self.entity_id = entity_id
        self.attributes = {"friendly_name": name}


class States:
    def __init__(self):
        self._s: dict[str, State] = {}

    def add(self, entity_id, name):
        self._s[entity_id] = State(entity_id, name)

    def async_all(self, domain=None):
        return [s for k, s in self._s.items() if domain is None or k.startswith(domain + ".")]


class Bus:
    def __init__(self):
        self.fired = []

    def async_fire(self, event, data=None):
        self.fired.append({"event": event, "data": data})


class FakeMealie:
    """Kleine Mealie-Attrappe mit Rezepten und Essensplan (Antwortformat wie die HA-Integration)."""

    def __init__(self):
        def ing(q, unit, food, note=""):
            return {"quantity": q, "unit": {"name": unit, "abbreviation": unit, "use_abbreviation": True} if unit else None,
                    "food": {"name": food} if food else None, "note": note, "display": f"{q or ''} {unit or ''} {food or note}".strip(), "original_text": None}
        self.recipes = {
            "r-bolo": {"recipe_id": "r-bolo", "slug": "spaghetti-bolognese", "name": "Spaghetti Bolognese", "image": "x", "recipe_servings": 4,
                       "ingredients": [ing(500, "g", "Spaghetti"), ing(400, "g", "Hackfleisch"), ing(1, None, "Zwiebel"), ing(None, None, None, "Salz und Pfeffer")]},
            "r-curry": {"recipe_id": "r-curry", "slug": "gemuesecurry", "name": "Gemüsecurry", "image": None,
                        "ingredients": [ing(1, "Dose", "Kokosmilch"), ing(2, None, "Zwiebel"), ing(250, "g", "Reis")]},
            "r-voressen": {"recipe_id": "r-voressen", "slug": "rindsvoressen", "name": "Rindsvoressen", "image": None,
                           "ingredients": [{"quantity": 1, "unit": None, "food": None, "note": "1 Bund Schnittlauch, fein geschnitten", "display": "1 1 Bund Schnittlauch, fein geschnitten", "original_text": None},
                                           {"quantity": 200, "unit": {"name": "g"}, "food": None, "note": "", "display": "200 g", "original_text": None},
                                           {"quantity": 0, "unit": None, "food": None, "note": "Salz, Pfeffer", "display": "Salz, Pfeffer", "original_text": None},
                                           {"quantity": 0, "unit": None, "food": None, "note": "Schnittlauch zum Garnieren", "display": "Schnittlauch zum Garnieren", "original_text": None}]},
            "r-muesli": {"recipe_id": "r-muesli", "slug": "birchermuesli", "name": "Birchermüesli", "image": None,
                         "ingredients": [ing(100, "g", "Haferflocken"), ing(2, None, "Äpfel")]},
        }
        self.plans = []
        self._n = 0

    def call(self, service, data):
        if service == "get_recipes":
            q = (data.get("search_terms") or "").lower()
            items = [{k: v for k, v in r.items() if k != "ingredients"} for r in self.recipes.values() if q in r["name"].lower()]
            return {"recipes": {"items": items[: int(data.get("result_limit") or 10)]}}
        if service == "get_recipe":
            rid = data["recipe_id"]
            r = self.recipes.get(rid) or next((x for x in self.recipes.values() if x["slug"] == rid), None)
            if not r:
                raise HomeAssistantError("Rezept nicht gefunden")
            return {"recipe": r}
        if service == "get_mealplan":
            a, b = date.fromisoformat(str(data["start_date"])), date.fromisoformat(str(data["end_date"]))
            return {"mealplan": [p for p in self.plans if a <= p["mealplan_date"] <= b]}
        if service == "set_mealplan":
            self._n += 1
            rec = self.recipes.get(data.get("recipe_id")) if data.get("recipe_id") else None
            if data.get("recipe_id") and not rec:
                raise HomeAssistantError("recipe_id muss eine Rezept-ID sein")
            self.plans.append({"mealplan_id": self._n, "entry_type": _Status(data["entry_type"]), "mealplan_date": date.fromisoformat(str(data["date"])),
                               "title": data.get("note_title") or "", "description": data.get("note_text") or "",
                               "recipe": {k: v for k, v in rec.items() if k != "ingredients"} if rec else None})
            return None
        if service == "delete_mealplan":
            self.plans = [p for p in self.plans if p["mealplan_id"] != int(data["mealplan_id"])]
            return None
        raise HomeAssistantError(f"Unbekannte Aktion mealie.{service}")


class _Entry:
    def __init__(self, entry_id, data):
        self.entry_id, self.data, self.state = entry_id, data, _Status("loaded")


class ConfigEntries:
    def __init__(self):
        self.entries = {"mealie": [_Entry("mealie1", {"host": "http://mealie.test"})]}

    def async_entries(self, domain):
        return self.entries.get(domain, [])


class Services:
    def __init__(self, hass):
        self.hass = hass
        self.calls = []

    def has_service(self, domain, service):
        return domain != "mealie" or bool(self.hass.config_entries.entries.get("mealie"))

    async def async_call(self, domain, service, data=None, target=None, blocking=False, return_response=False):
        data = data or {}
        eid = (target or {}).get("entity_id")
        self.calls.append({"service": f"{domain}.{service}", "data": data, "target": eid})
        if domain == "mealie":
            if data.get("config_entry_id") != "mealie1":
                raise HomeAssistantError("config_entry_id fehlt oder falsch")
            return self.hass.mealie.call(service, data)
        ent = self.hass.data[domain].get_entity(eid)
        if ent is None:
            raise HomeAssistantError(f"Entität {eid} nicht gefunden")
        if (domain, service) == ("todo", "add_item"):
            ent.add(data["item"])
            ent.todo_items[-1].description = data.get("description")
        elif (domain, service) == ("todo", "update_item"):
            for i in ent.todo_items:
                if i.uid == data["item"] or i.summary == data["item"]:
                    i.status = _Status(data.get("status", "needs_action"))
                    break
            else:
                raise HomeAssistantError("Eintrag nicht gefunden")
        elif (domain, service) == ("calendar", "create_event"):
            if "start_date" in data:
                ent.add(data["summary"], date.fromisoformat(data["start_date"]), date.fromisoformat(data["end_date"]), data.get("description"))
            else:
                ent.add(
                    data["summary"],
                    datetime.fromisoformat(data["start_date_time"]).astimezone(),
                    datetime.fromisoformat(data["end_date_time"]).astimezone(),
                    data.get("description"),
                )
        else:
            raise HomeAssistantError(f"Unbekannte Aktion {domain}.{service}")


class FakeHass:
    def __init__(self):
        self.data = {"calendar": Component(), "todo": Component()}
        self.states = States()
        self.platforms: dict[str, str] = {}
        self.bus = Bus()
        self.services = Services(self)
        self.config_entries = ConfigEntries()
        self.mealie = FakeMealie()

    async def async_add_executor_job(self, func, *args):
        return func(*args)


def build():
    hass = FakeHass()
    now = datetime.now().astimezone().replace(minute=0, second=0, microsecond=0)
    fam = FakeCalendar()
    fam.add("Grosseltern zu Besuch", now.date() + timedelta(days=2), now.date() + timedelta(days=3))
    fam.add("Elternabend", now.replace(hour=19), now.replace(hour=21))
    vater = FakeCalendar()
    vater.add("Zahnarzt", now.replace(hour=9), now.replace(hour=10))
    for eid, name, ent in (("calendar.familie", "Familie", fam), ("calendar.vater", "Vater", vater)):
        hass.data["calendar"].entities[eid] = ent
        hass.states.add(eid, name)
        hass.platforms[eid] = "local_calendar"
    bring = FakeTodo()
    for x in ("Milch", "Brot"):
        bring.add(x)
    hass.data["todo"].entities["todo.zuhause"] = bring
    hass.states.add("todo.zuhause", "Zuhause")
    hass.platforms["todo.zuhause"] = "bring"
    hass.data["todo"].entities["todo.einkaufsliste"] = FakeTodo()
    hass.states.add("todo.einkaufsliste", "Einkaufsliste")
    hass.platforms["todo.einkaufsliste"] = "shopping_list"
    hass.states.add("person.vater", "Vater")
    hass.states.add("person.mutter", "Mutter")
    hub = hub_mod.FamilienzentraleHub(hass, "test")
    return hass, hub


LOOP = asyncio.new_event_loop()
threading.Thread(target=LOOP.run_forever, daemon=True).start()
fake_storage._MEM.clear()
HASS, HUB = build()
asyncio.run_coroutine_threadsafe(HUB.async_load(), LOOP).result()


def run(coro):
    return asyncio.run_coroutine_threadsafe(coro, LOOP).result(timeout=10)


def debug():
    cal = {k: [{"uid": e.uid, "summary": e.summary, "start": str(e.start), "description": e.description, "rrule": e.rrule, "exdates": sorted(e.exdates)} for e in v.events] for k, v in HASS.data["calendar"].entities.items()}
    todo = {k: [{"uid": i.uid, "summary": i.summary, "status": i.status.value, "description": getattr(i, "description", None)} for i in v.todo_items] for k, v in HASS.data["todo"].entities.items()}
    plans = [{"id": p["mealplan_id"], "type": p["entry_type"].value, "date": str(p["mealplan_date"]), "title": p["title"], "recipe": (p["recipe"] or {}).get("name")} for p in HASS.mealie.plans]
    return {"mealie": plans, "data": HUB.data, "calendars": cal, "todo": todo, "events": HASS.bus.fired, "service_calls": HASS.services.calls, "stored": fake_storage._MEM}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def log_message(self, fmt, *args):  # ruhig
        pass

    def _json(self, code, obj):
        body = json.dumps(obj, default=str, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/debug"):
            return self._json(200, debug())
        return super().do_GET()

    def do_POST(self):
        global HASS, HUB
        length = int(self.headers.get("Content-Length") or 0)
        msg = json.loads(self.rfile.read(length) or b"{}")
        if self.path == "/api/reset":
            fake_storage._MEM.clear()
            HASS, HUB = build()
            run(HUB.async_load())
            return self._json(200, {"ok": True})
        if self.path == "/api/mealie_off":
            HASS.config_entries.entries["mealie"] = []
            return self._json(200, {"ok": True})
        if self.path == "/api/reload":
            # wie ein HA-Neustart: gespeicherte Daten neu laden
            HUB = hub_mod.FamilienzentraleHub(HASS, "test")
            run(HUB.async_load())
            return self._json(200, {"ok": True})
        try:
            if msg.get("type") == "familienzentrale/state":
                res = run(HUB.async_state())
            elif msg.get("type") == "familienzentrale/action":
                res = run(HUB.async_action(msg["action"], dict(msg.get("data") or {}), "test"))
            else:
                return self._json(200, {"ok": False, "code": "unknown", "message": "unbekannter Befehl"})
            return self._json(200, {"ok": True, "result": res})
        except HomeAssistantError as err:
            return self._json(200, {"ok": False, "code": "action_failed", "message": str(err)})
        except Exception as err:  # noqa: BLE001
            import traceback

            traceback.print_exc()
            return self._json(200, {"ok": False, "code": "crash", "message": f"{type(err).__name__}: {err}"})


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8770
    print(f"Testserver auf http://127.0.0.1:{port}/tests/e2e.html", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()

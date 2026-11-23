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
photos_mod = importlib.import_module("fz.photos")
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
        self.overrides: dict = {}  # rid -> DictComp-Daten (VEVENT mit RECURRENCE-ID)


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
        ov = ev.overrides.get(rid)
        if ov:
            out.append(CalEvent(ev.uid, ov.get("SUMMARY"), ov["DTSTART"], ov["DTEND"], ov.get("LOCATION"), ov.get("DESCRIPTION"), None, rid))
            continue
        out.append(CalEvent(ev.uid, ev.summary, start, start + dur, ev.location, ev.description, ev.rrule, rid))
    return out


class FakeCalendar:
    def __init__(self):
        self.events: list[CalEvent] = []
        self._n = 0

    def add(self, summary, start, end, description=None, rrule=None):
        self._n += 1
        self.rrule_types = getattr(self, "rrule_types", [])
        self.rrule_types.append(type(rrule).__name__)
        if isinstance(rrule, dict):  # CalDAV-Format zurück in Text, nur für die Test-Auflösung
            def fmt(k, v):
                if k == "UNTIL":
                    return v.strftime("%Y%m%dT%H%M%SZ") if isinstance(v, datetime) else v.strftime("%Y%m%d")
                return ",".join(str(x) for x in v) if isinstance(v, list) else str(v)
            rrule = ";".join(f"{k}={fmt(k, v)}" for k, v in rrule.items())
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

    async def async_update_event(self, uid, event, recurrence_id=None, recurrence_range=None):
        ev = next(e for e in self.events if e.uid == uid)
        if ev.rrule and recurrence_id and recurrence_range != "THISANDFUTURE":
            ev.exdates.add(recurrence_id)
            self.add(event["summary"], event["dtstart"], event["dtend"], event.get("description"))
            return
        ev.summary = event["summary"]
        ev.description = event.get("description")
        if ev.rrule:
            ev.start = datetime.combine(ev.start.date(), event["dtstart"].timetz()) if isinstance(ev.start, datetime) else ev.start
            ev.end = ev.start + (event["dtend"] - event["dtstart"])
        else:
            ev.start, ev.end = event["dtstart"], event["dtend"]

    async def async_delete_event(self, uid, recurrence_id=None, recurrence_range=None):
        if recurrence_id:
            for e in self.events:
                if e.uid == uid:
                    e.exdates.add(recurrence_id)
            return
        self.events = [e for e in self.events if e.uid != uid]


class _Prop:
    def __init__(self, dt):
        self.dt = dt


class _ExList:
    def __init__(self, dts):
        self.dts = dts


def _rid(v):
    return v.strftime("%Y%m%dT%H%M%S") if isinstance(v, datetime) else v.strftime("%Y%m%d")


class DictComp:
    """Eigenständiges VEVENT (Ausnahme einer Serie)."""

    name = "VEVENT"

    def __init__(self, d=None):
        self.d = d if d is not None else {}

    def __contains__(self, k):
        return k.upper() in self.d

    def pop(self, k):
        self.d.pop(k.upper(), None)

    def add(self, k, v):
        self.d[k.upper()] = v.dt if isinstance(v, _Prop) else v

    def get(self, k):
        v = self.d.get(k.upper())
        return _Prop(v) if k.upper() in ("DTSTART", "DTEND", "RECURRENCE-ID") else v


class FakeInst:
    def __init__(self, ev):
        self.ev = ev
        self.subcomponents = [FakeComp(ev)] + [DictComp(dict(d)) for d in ev.overrides.values()]

    def add_component(self, c):
        self.subcomponents.append(c)


class FakeComp:
    """Wie icalendar.Component, nur das Nötigste für caldav_edit."""

    name = "VEVENT"

    def __new__(cls, ev=None):
        if ev is None:  # type(master)() -> neue Ausnahme
            return DictComp()
        return super().__new__(cls)

    def __init__(self, ev=None):
        self.ev = ev

    def __contains__(self, k):
        k = k.upper()
        return {"RRULE": bool(self.ev.rrule), "SUMMARY": True, "DTSTART": True, "DTEND": True,
                "DESCRIPTION": self.ev.description is not None, "LOCATION": self.ev.location is not None}.get(k, False)

    def pop(self, k):
        if k.upper() == "EXDATE":
            self.ev.exdates = set()
            return
        setattr(self.ev, {"SUMMARY": "summary", "DESCRIPTION": "description", "LOCATION": "location", "DTSTART": "start", "DTEND": "end"}.get(k.upper(), "_x"), None)

    def add(self, k, v):
        k = k.lower()
        if k == "exdate":
            for x in v if isinstance(v, list) else [v]:
                self.ev.exdates.add(_rid(x))
        else:
            setattr(self.ev, {"summary": "summary", "description": "description", "location": "location", "dtstart": "start", "dtend": "end"}[k], v)

    def get(self, k):
        if k.upper() == "UID":
            return self.ev.uid
        if k.upper() == "EXDATE":
            if not self.ev.exdates:
                return None
            tz = self.ev.start.tzinfo if isinstance(self.ev.start, datetime) else None
            def back(r):
                if len(r) == 8:
                    return date(int(r[:4]), int(r[4:6]), int(r[6:8]))
                return datetime.strptime(r, "%Y%m%dT%H%M%S").replace(tzinfo=tz)
            return _ExList([_Prop(back(r)) for r in sorted(self.ev.exdates)])
        return _Prop(self.ev.start if k.upper() == "DTSTART" else self.ev.end)


class FakeCaldavEvent:
    def __init__(self, fc, ev):
        self.fc, self.ev = fc, ev
        self.icalendar_instance = FakeInst(ev)
        self.icalendar_component = self.icalendar_instance.subcomponents[0]

    def save(self):
        self.fc.saved = getattr(self.fc, "saved", 0) + 1
        self.ev.overrides = {_rid(c.d["RECURRENCE-ID"]): c.d for c in self.icalendar_instance.subcomponents if isinstance(c, DictComp)}

    def delete(self):
        self.fc.events = [e for e in self.fc.events if e is not self.ev]


class FakeCaldavCal:
    """Wie caldav.Calendar der HA-Integration (coordinator.calendar)."""

    def __init__(self, fc):
        self.fc = fc

    def get_event_by_uid(self, uid):
        # wie iCloud: Suche nach UID wird abgelehnt
        raise RuntimeError("ReportError at '412 Precondition Failed ', reason no reason")

    def search(self, start=None, end=None, event=True, expand=False):
        self.fc.searches = getattr(self.fc, "searches", 0) + 1
        out = []
        for e in self.fc.events:
            s0 = e.start if isinstance(e.start, datetime) else datetime(e.start.year, e.start.month, e.start.day).astimezone()
            if s0 <= end:  # Serien-Master liegt oft vor dem Zeitraum
                out.append(FakeCaldavEvent(self.fc, e))
        return out

    def add_event(self, **kw):
        self.fc.add(kw["summary"], kw["dtstart"], kw["dtend"], kw.get("description"), kw.get("rrule"))


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

    def add(self, entity_id, name, features=None):
        self._s[entity_id] = State(entity_id, name)
        if features is not None:
            self._s[entity_id].attributes["supported_features"] = features

    def get(self, entity_id):
        return self._s.get(entity_id)

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

    def async_services(self):
        # zwei iPhones: das der Mutter ist (wie in echt manchmal) nicht erreichbar
        return {"notify": {"send_message": None, "mobile_app_iphone_vater": None, "mobile_app_iphone_mutter": None}}

    async def async_call(self, domain, service, data=None, target=None, blocking=False, return_response=False):
        data = data or {}
        eid = (target or {}).get("entity_id")
        self.calls.append({"service": f"{domain}.{service}", "data": data, "target": eid})
        if domain == "notify":
            if service == "mobile_app_iphone_mutter":
                raise HomeAssistantError("Gerät nicht erreichbar")
            return None
        if (domain, service) == ("media_player", "play_media"):
            return None
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
        self.config = types.SimpleNamespace(media_dirs={"local": str(make_media())})

    async def async_add_executor_job(self, func, *args):
        return func(*args)

    def async_create_task(self, coro):
        return asyncio.ensure_future(coro)


def make_media() -> Path:
    """Beispielfotos für den Bilderrahmen (werden einmal erzeugt, nicht im Repository)."""
    folder = ROOT / "tests" / "media" / "Bilder"
    if not (folder / "urlaub").is_dir():
        from PIL import Image, ImageDraw

        (folder / "urlaub").mkdir(parents=True, exist_ok=True)
        for i, (c1, c2, size) in enumerate([("#ff9a9e", "#fad0c4", (3000, 2000)), ("#84fab0", "#8fd3f4", (2000, 3000)), ("#a18cd1", "#fbc2eb", (2400, 1800))]):
            img = Image.new("RGB", size, c1)
            d = ImageDraw.Draw(img)
            d.ellipse([size[0] // 4, size[1] // 4, size[0] * 3 // 4, size[1] * 3 // 4], fill=c2)
            d.text((40, 40), f"Testfoto {i + 1}", fill="#000")
            img.save(folder / ("urlaub" if i else "") / f"foto{i + 1}.jpg", quality=85)
        (folder / "notiz.txt").write_text("kein Bild", encoding="utf-8")
    return folder.parent


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
        hass.states.add(eid, name, 7)
        hass.platforms[eid] = "local_calendar"
    # wie iCloud über CalDAV: nur Anlegen erlaubt
    icloud = FakeCalendar()
    icloud.coordinator = types.SimpleNamespace(calendar=FakeCaldavCal(icloud))
    hass.data["calendar"].entities["calendar.icloud"] = icloud
    hass.states.add("calendar.icloud", "iCloud", 1)
    hass.platforms["calendar.icloud"] = "caldav"
    # Benachrichtigungen: Telegram, Sonos, Sprachausgabe
    for eid, name, plat in (("notify.telegram_familie", "Telegram Familie", "telegram_bot"), ("notify.iphone_vater", "iPhone Vater", "mobile_app"),
                            ("media_player.kuche", "Küche", "sonos"), ("tts.google_de", "Google Übersetzer", "google_translate")):
        hass.states.add(eid, name)
        hass.platforms[eid] = plat
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
    cal = {k: [{"uid": e.uid, "summary": e.summary, "start": str(e.start), "description": e.description, "rrule": e.rrule, "exdates": sorted(e.exdates), "overrides": {k: v.get("SUMMARY") for k, v in e.overrides.items()}, "rrule_type": (getattr(v, "rrule_types", []) or [None])[i] if i < len(getattr(v, "rrule_types", [])) else None} for i, e in enumerate(v.events)] for k, v in HASS.data["calendar"].entities.items()}
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
        if self.path.startswith("/api/familienzentrale/foto/"):
            idx = self.path.split("/")[-1].split("?")[0]
            path = HUB.photos.path(int(idx)) if idx.isdigit() else None
            if not path:
                self.send_error(404)
                return
            data = photos_mod.shrink(path)
            self.send_response(200)
            self.send_header("Content-Type", "image/jpeg")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
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

"""Anbindung an Mealie über die offizielle Home-Assistant-Integration „mealie“.

Die Familienzentrale spricht nie direkt mit Mealie und kennt keinen Token. Sie ruft
nur die Aktionen der Integration auf (mealie.get_mealplan, get_recipes, get_recipe,
set_mealplan, delete_mealplan).
"""

from __future__ import annotations

import logging
import time
from datetime import date, timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError

from .ingredients import ingredient_line, norm

_LOGGER = logging.getLogger(__name__)

# Felder im Essensplan der Familienzentrale  <->  Gerichtstyp in Mealie
SLOT_TO_TYPE = {
    "fruehstueck": "breakfast",
    "mittag": "lunch",
    "abend": "dinner",
    "beilage": "side",
    "nachtisch": "dessert",
    "snack": "snack",
    "getraenk": "drink",
}
TYPE_TO_SLOT = {v: k for k, v in SLOT_TO_TYPE.items()}
CACHE_SECONDS = 120


def _val(x: Any) -> str:
    return str(getattr(x, "value", x) or "")


def _iso(x: Any) -> str:
    return x.isoformat()[:10] if hasattr(x, "isoformat") else str(x or "")[:10]


class MealieBridge:
    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._cache: dict[str, Any] = {"ts": 0.0, "key": None, "meals": {}}
        self.error: str | None = None

    # ---------- Grundlagen ----------
    def entry(self):
        for e in self.hass.config_entries.async_entries("mealie"):
            if _val(getattr(e, "state", "")).lower() in ("loaded", "configentrystate.loaded") or getattr(getattr(e, "state", None), "name", "") == "LOADED":
                return e
        return None

    @property
    def available(self) -> bool:
        return self.entry() is not None and self.hass.services.has_service("mealie", "get_mealplan")

    def host(self) -> str | None:
        e = self.entry()
        host = (e.data or {}).get("host") if e else None
        return str(host).rstrip("/") if host else None

    async def _call(self, service: str, data: dict[str, Any], response: bool = True) -> Any:
        e = self.entry()
        if e is None:
            raise HomeAssistantError("Mealie ist in Home Assistant nicht eingerichtet")
        payload = {"config_entry_id": e.entry_id, **data}
        return await self.hass.services.async_call("mealie", service, payload, blocking=True, return_response=response)

    def invalidate(self) -> None:
        self._cache["ts"] = 0.0

    # ---------- Essensplan ----------
    async def async_meals(self, start: date, end: date) -> dict[str, dict[str, Any]]:
        """{datum: {feld: {name, recipe, recipe_id, mealplan_id, more}}} – zwischengespeichert."""
        key = f"{start}|{end}"
        if self._cache["key"] == key and time.monotonic() - self._cache["ts"] < CACHE_SECONDS:
            return self._cache["meals"]
        try:
            res = await self._call("get_mealplan", {"start_date": start.isoformat(), "end_date": end.isoformat()})
            self.error = None
        except Exception as err:  # noqa: BLE001 - Mealie nicht erreichbar darf das Panel nicht blockieren
            self.error = str(err) or type(err).__name__
            _LOGGER.warning("Essensplan aus Mealie nicht lesbar: %s", self.error)
            return self._cache["meals"] if self._cache["key"] == key else {}
        meals: dict[str, dict[str, Any]] = {}
        for mp in (res or {}).get("mealplan") or []:
            slot = TYPE_TO_SLOT.get(_val(mp.get("entry_type")).lower())
            day = _iso(mp.get("mealplan_date"))
            if not slot or not day:
                continue
            recipe = mp.get("recipe") or {}
            item = {
                "name": recipe.get("name") or mp.get("title") or "Notiz",
                "recipe": recipe.get("slug"),
                "recipe_id": str(recipe.get("recipe_id")) if recipe.get("recipe_id") else None,
                "image": self._image(recipe),
                "mealplan_id": mp.get("mealplan_id"),
                "ids": [mp.get("mealplan_id")],
                "more": 0,
            }
            cur = meals.setdefault(day, {}).get(slot)
            if cur:
                cur["more"] += 1
                cur["ids"].append(mp.get("mealplan_id"))
            else:
                meals[day][slot] = item
        self._cache = {"ts": time.monotonic(), "key": key, "meals": meals}
        return meals

    def _image(self, recipe: dict) -> str | None:
        host = self.host()
        rid = recipe.get("recipe_id")
        if not host or not rid or not recipe.get("image"):
            return None
        return f"{host}/api/media/recipes/{rid}/images/min-original.webp"

    async def async_set_meal(self, day: str, slot: str, meal: dict | None, old: dict | None) -> None:
        entry_type = SLOT_TO_TYPE.get(slot)
        if not entry_type:
            raise HomeAssistantError("Unbekanntes Feld im Essensplan")
        # bisherige Einträge dieses Feldes ersetzen
        for mid in (old or {}).get("ids") or []:
            if mid is not None:
                await self._call("delete_mealplan", {"mealplan_id": mid}, response=False)
        if meal:
            data: dict[str, Any] = {"date": day, "entry_type": entry_type}
            if meal.get("recipe_id"):
                data["recipe_id"] = meal["recipe_id"]
            else:
                data["note_title"] = str(meal.get("name") or "Notiz")[:200]
            await self._call("set_mealplan", data, response=False)
        self.invalidate()

    # ---------- Rezepte ----------
    async def async_search(self, query: str, limit: int = 24) -> list[dict[str, Any]]:
        data: dict[str, Any] = {"result_limit": limit}
        if query:
            data["search_terms"] = query
        res = await self._call("get_recipes", data)
        items = ((res or {}).get("recipes") or {})
        items = items.get("items") if isinstance(items, dict) else items
        out = []
        for r in items or []:
            out.append({"slug": r.get("slug"), "name": r.get("name"), "recipe_id": str(r.get("recipe_id")) if r.get("recipe_id") else None, "image": self._image(r)})
        return out

    async def async_recipe_id(self, slug_or_id: str) -> str | None:
        try:
            res = await self._call("get_recipe", {"recipe_id": slug_or_id})
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Rezept %s nicht gefunden: %s", slug_or_id, err)
            return None
        rid = ((res or {}).get("recipe") or {}).get("recipe_id")
        return str(rid) if rid else None

    async def async_find_by_name(self, name: str) -> str | None:
        """Rezept mit genau diesem Namen (Gross-/Kleinschreibung egal) suchen."""
        name = (name or "").strip()
        if not name:
            return None
        try:
            found = await self.async_search(name, 10)
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Rezeptsuche nach %s fehlgeschlagen: %s", name, err)
            return None
        for r in found:
            if (r.get("name") or "").strip().casefold() == name.casefold():
                return r.get("recipe_id") or r.get("slug")
        return None

    async def async_ingredients(self, recipe_ids: list[str]) -> list[dict[str, str]]:
        """Zutaten mehrerer Rezepte, gleiche Lebensmittel zusammengefasst."""
        merged: dict[str, dict[str, Any]] = {}
        for rid in recipe_ids:
            if not rid:
                continue
            try:
                res = await self._call("get_recipe", {"recipe_id": rid})
            except Exception as err:  # noqa: BLE001
                _LOGGER.warning("Rezept %s nicht lesbar: %s", rid, err)
                continue
            recipe = (res or {}).get("recipe") or {}
            for ing in recipe.get("ingredients") or []:
                line = ingredient_line(ing)
                if not line["name"]:
                    continue
                key = norm(line["name"])
                if key in merged:
                    if line["spec"] and line["spec"] not in merged[key]["specs"]:
                        merged[key]["specs"].append(line["spec"])
                    merged[key]["recipes"].add(recipe.get("name"))
                else:
                    merged[key] = {"name": line["name"], "specs": [line["spec"]] if line["spec"] else [], "recipes": {recipe.get("name")}}
        return [
            {"name": m["name"], "spec": " + ".join(m["specs"]), "recipes": sorted(x for x in m["recipes"] if x)}
            for m in merged.values()
        ]

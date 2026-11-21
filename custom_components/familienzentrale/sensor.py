"""Sensoren: Punktestand und offene Aufgaben pro Person, nächste Müllabfuhr, fällige Wartungen."""

from __future__ import annotations

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import logic
from .const import DOMAIN, PANEL_TITLE, VERSION
from .hub import FamilienzentraleHub


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback) -> None:
    hub: FamilienzentraleHub = hass.data[DOMAIN][entry.entry_id]
    known: set[str] = set()

    async_add_entities([NextWasteSensor(hub), MaintenanceDueSensor(hub)])

    @callback
    def _sync_persons() -> None:
        new = []
        for p in hub.data["persons"]:
            if p["id"] in known:
                continue
            known.add(p["id"])
            new.append(PointsSensor(hub, p["id"]))
            new.append(OpenTasksSensor(hub, p["id"]))
        if new:
            async_add_entities(new)

    _sync_persons()
    entry.async_on_unload(hub.async_add_listener(_sync_persons))


class _Base(SensorEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, hub: FamilienzentraleHub) -> None:
        self.hub = hub
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, hub.entry_id)}, name=PANEL_TITLE, sw_version=VERSION, entry_type=None
        )

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self.hub.async_add_listener(self.async_write_ha_state))


class _PersonBase(_Base):
    def __init__(self, hub: FamilienzentraleHub, person_id: str) -> None:
        super().__init__(hub)
        self.person_id = person_id

    @property
    def person(self) -> dict | None:
        return next((p for p in self.hub.data["persons"] if p["id"] == self.person_id), None)

    @property
    def available(self) -> bool:
        return self.person is not None


class PointsSensor(_PersonBase):
    _attr_icon = "mdi:star-circle"
    _attr_native_unit_of_measurement = "Punkte"

    def __init__(self, hub: FamilienzentraleHub, person_id: str) -> None:
        super().__init__(hub, person_id)
        self._attr_unique_id = f"{hub.entry_id}_{person_id}_punkte"

    @property
    def name(self) -> str:
        p = self.person
        return f"Punkte {p['name']}" if p else "Punkte"

    @property
    def native_value(self) -> int | None:
        return logic.points(self.hub.data, self.person_id) if self.person else None

    @property
    def extra_state_attributes(self) -> dict:
        return {"verfuegbar": logic.available(self.hub.data, self.person_id)} if self.person else {}


class OpenTasksSensor(_PersonBase):
    _attr_icon = "mdi:checkbox-marked-circle-outline"
    _attr_native_unit_of_measurement = "Aufgaben"

    def __init__(self, hub: FamilienzentraleHub, person_id: str) -> None:
        super().__init__(hub, person_id)
        self._attr_unique_id = f"{hub.entry_id}_{person_id}_offen"

    @property
    def name(self) -> str:
        p = self.person
        return f"Offene Aufgaben {p['name']}" if p else "Offene Aufgaben"

    @property
    def native_value(self) -> int | None:
        return logic.open_tasks(self.hub.data, self.person_id, self.hub.today()) if self.person else None

    @property
    def extra_state_attributes(self) -> dict:
        if not self.person:
            return {}
        today = self.hub.today()
        return {
            "aufgaben": [
                t.get("name")
                for t in self.hub.data["tasks"]
                if logic.task_person(t, today) == self.person_id and logic.task_due(t, today)
            ]
        }


class NextWasteSensor(_Base):
    _attr_icon = "mdi:trash-can-outline"
    _attr_device_class = SensorDeviceClass.DATE
    _attr_name = "Nächste Müllabfuhr"

    def __init__(self, hub: FamilienzentraleHub) -> None:
        super().__init__(hub)
        self._attr_unique_id = f"{hub.entry_id}_naechste_muellabfuhr"

    def _next(self):
        today = self.hub.today()
        best = None
        for w in self.hub.data["waste"]:
            ds = logic.waste_dates(w, 1, today)
            if ds and (best is None or ds[0] < best[0]):
                best = (ds[0], [w.get("name")])
            elif ds and best and ds[0] == best[0]:
                best[1].append(w.get("name"))
        return best

    @property
    def native_value(self):
        n = self._next()
        return n[0] if n else None

    @property
    def extra_state_attributes(self) -> dict:
        n = self._next()
        return {"arten": n[1]} if n else {}


class MaintenanceDueSensor(_Base):
    _attr_icon = "mdi:wrench-clock"
    _attr_name = "Fällige Wartungen"
    _attr_native_unit_of_measurement = "Wartungen"

    def __init__(self, hub: FamilienzentraleHub) -> None:
        super().__init__(hub)
        self._attr_unique_id = f"{hub.entry_id}_wartung_faellig"

    def _due(self) -> list[dict]:
        today = self.hub.today()
        return [m for m in self.hub.data["maintenance"] if logic.maint_status(m, today) != "ok"]

    @property
    def native_value(self) -> int:
        return len(self._due())

    @property
    def extra_state_attributes(self) -> dict:
        return {"wartungen": [m.get("name") for m in self._due()]}

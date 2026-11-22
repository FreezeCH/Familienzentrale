"""Familienzentrale: Familienkalender, Aufgaben, Punkte, Essensplan und mehr."""

from __future__ import annotations

import logging
from datetime import timedelta
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED, Platform
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_change, async_track_time_interval

from . import websocket
from .const import DOMAIN, PANEL_ELEMENT, PANEL_ICON, PANEL_TITLE, PANEL_URL, STATIC_URL, VERSION
from .hub import FamilienzentraleHub

_LOGGER = logging.getLogger(__name__)

PLATFORMS = [Platform.SENSOR]
_FLAG_STATIC = f"{DOMAIN}_static_registered"
_FLAG_WS = f"{DOMAIN}_ws_registered"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hub = FamilienzentraleHub(hass, entry.entry_id)
    await hub.async_load()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = hub

    if not hass.data.get(_FLAG_WS):
        websocket.async_register(hass)
        hass.data[_FLAG_WS] = True

    if not hass.data.get(_FLAG_STATIC):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(STATIC_URL, str(Path(__file__).parent / "frontend"), cache_headers=False)]
        )
        hass.data[_FLAG_STATIC] = True

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=PANEL_ELEMENT,
        frontend_url_path=PANEL_URL,
        module_url=f"{STATIC_URL}/familienzentrale-panel.js?v={VERSION}",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=False,
        config={},
    )

    # Panel aktualisieren, wenn sich die Einkaufsliste ändert (z. B. Eintrag in der Bring-App)
    @callback
    def _state_filter(event_data) -> bool:
        return event_data["entity_id"] == hub.data["settings"]["mealie"].get("bring_list")

    @callback
    def _list_changed(event: Event) -> None:
        hub.async_notify()

    entry.async_on_unload(hass.bus.async_listen(EVENT_STATE_CHANGED, _list_changed, event_filter=_state_filter))

    @callback
    def _tick(now) -> None:
        hub.invalidate_events()
        hub.async_notify()

    # Kurz nach Mitternacht: neue Tagesaufgaben; alle 5 Minuten: Termine auffrischen
    entry.async_on_unload(async_track_time_change(hass, _tick, hour=0, minute=0, second=5))
    entry.async_on_unload(async_track_time_interval(hass, _tick, timedelta(minutes=5)))

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _LOGGER.debug("Familienzentrale %s geladen", VERSION)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        frontend.async_remove_panel(hass, PANEL_URL)
        hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return ok


async def async_remove_entry(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Beim Löschen der Integration auch die gespeicherten Daten entfernen."""
    from homeassistant.helpers.storage import Store

    from .const import STORAGE_KEY, STORAGE_VERSION

    await Store(hass, STORAGE_VERSION, STORAGE_KEY).async_remove()

"""WebSocket-Befehle für das Panel."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


def _hub(hass: HomeAssistant):
    hubs = hass.data.get(DOMAIN) or {}
    return next(iter(hubs.values()), None)


@callback
def async_register(hass: HomeAssistant) -> None:
    websocket_api.async_register_command(hass, ws_state)
    websocket_api.async_register_command(hass, ws_action)
    websocket_api.async_register_command(hass, ws_subscribe)


@websocket_api.websocket_command({vol.Required("type"): "familienzentrale/state"})
@websocket_api.async_response
async def ws_state(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Familienzentrale ist nicht eingerichtet")
        return
    connection.send_result(msg["id"], await hub.async_state())


@websocket_api.websocket_command(
    {
        vol.Required("type"): "familienzentrale/action",
        vol.Required("action"): str,
        vol.Optional("data", default={}): dict,
    }
)
@websocket_api.async_response
async def ws_action(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Familienzentrale ist nicht eingerichtet")
        return
    user = connection.user
    try:
        result = await hub.async_action(msg["action"], dict(msg.get("data") or {}), user.name if user else None)
    except HomeAssistantError as err:
        connection.send_error(msg["id"], "action_failed", str(err))
        return
    except (ValueError, TypeError, KeyError) as err:
        _LOGGER.warning("Aktion %s fehlgeschlagen: %s", msg["action"], err)
        connection.send_error(msg["id"], "invalid", f"Ungültige Daten: {err}")
        return
    connection.send_result(msg["id"], result)


@websocket_api.websocket_command({vol.Required("type"): "familienzentrale/subscribe"})
@websocket_api.async_response
async def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    hub = _hub(hass)
    if hub is None:
        connection.send_error(msg["id"], "not_loaded", "Familienzentrale ist nicht eingerichtet")
        return
    msg_id = msg["id"]
    pending: dict[str, bool] = {"busy": False, "again": False}

    async def _push() -> None:
        # Mehrere Änderungen kurz hintereinander zu einer Meldung zusammenfassen
        if pending["busy"]:
            pending["again"] = True
            return
        pending["busy"] = True
        try:
            while True:
                pending["again"] = False
                state = await hub.async_state()
                connection.send_message(websocket_api.event_message(msg_id, state))
                if not pending["again"]:
                    break
        finally:
            pending["busy"] = False

    @callback
    def _changed() -> None:
        hass.async_create_task(_push())

    connection.subscriptions[msg_id] = hub.async_add_listener(_changed)
    connection.send_result(msg_id)

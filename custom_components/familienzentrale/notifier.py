"""Benachrichtigungen: Push (Handy-App), Telegram und Sprachansagen auf Sonos.

Jeder Empfänger wird einzeln angesprochen. Fällt einer aus (z. B. ein iPhone, das keine
Push-Nachrichten bekommt), erhalten die anderen ihre Nachricht trotzdem; der Fehler wird
nur protokolliert und beim Testversand angezeigt.

Empfänger-Kennungen:
- "notify.mobile_app_xyz"  → Aktion notify.mobile_app_xyz (iPhone/iPad, kann Link und Knöpfe)
- "notify.xyz"             → Benachrichtigungs-Entität (z. B. Telegram), über notify.send_message
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

_LOGGER = logging.getLogger(__name__)

# Knöpfe in der iPhone-Nachricht (mobile_app_notification_action)
ACTION_OK = "FZ_OK_"
ACTION_NO = "FZ_NO_"


def _nice(name: str) -> str:
    return name.replace("_", " ").strip().title()


def targets(hass: HomeAssistant) -> list[dict[str, Any]]:
    """Mögliche Empfänger für Push und Telegram."""
    out: list[dict[str, Any]] = []
    services = (hass.services.async_services() or {}).get("notify", {})
    app_names = set()
    for svc in sorted(services):
        if svc.startswith("mobile_app_"):
            app_names.add(svc[len("mobile_app_"):])
            out.append({"id": f"notify.{svc}", "name": "📱 " + _nice(svc[len("mobile_app_"):]), "kind": "app"})
    reg = er.async_get(hass)
    for state in hass.states.async_all("notify"):
        ent = reg.async_get(state.entity_id)
        platform = ent.platform if ent else None
        if platform == "mobile_app":
            continue  # schon als Handy-App oben (die Aktion kann mehr: Link, Knöpfe)
        name = state.attributes.get("friendly_name") or state.entity_id
        icon = "✈️ " if platform == "telegram_bot" else "🔔 "
        out.append({"id": state.entity_id, "name": icon + name, "kind": "entity"})
    return out


async def send(hass: HomeAssistant, ids: list[str], title: str, message: str,
               url: str | None = None, actions: list[dict[str, str]] | None = None) -> list[dict[str, Any]]:
    """An alle Empfänger senden. Gibt pro Empfänger {id, ok, error} zurück."""
    results = []
    for tid in ids or []:
        try:
            domain, _, obj = str(tid).partition(".")
            if domain != "notify" or not obj:
                raise ValueError("ungültiger Empfänger")
            if obj.startswith("mobile_app_"):
                data: dict[str, Any] = {"push": {"interruption-level": "time-sensitive"}}
                if url:
                    data["url"] = url
                if actions:
                    data["actions"] = actions
                await hass.services.async_call("notify", obj, {"title": title, "message": message, "data": data}, blocking=True)
            else:
                await hass.services.async_call("notify", "send_message", {"title": title, "message": message},
                                               target={"entity_id": tid}, blocking=True)
            results.append({"id": tid, "ok": True})
        except Exception as err:  # noqa: BLE001 - ein Empfänger darf die anderen nicht stoppen
            _LOGGER.warning("Familienzentrale: Nachricht an %s fehlgeschlagen: %s", tid, err)
            results.append({"id": tid, "ok": False, "error": str(err)})
    return results


def tts_url(tts_entity: str, message: str, language: str | None) -> str:
    url = f"media-source://tts/{tts_entity}?message={quote(message)}"
    if language:
        url += f"&language={quote(language)}"
    return url


async def speak(hass: HomeAssistant, players: list[str], tts_entity: str | None, message: str,
                language: str | None = "de", volume: float | None = None) -> list[dict[str, Any]]:
    """Sprachansage auf den Lautsprechern (Sonos: als Durchsage, Musik läuft danach weiter)."""
    results = []
    if not players:
        return results
    if not tts_entity:
        tts = sorted(s.entity_id for s in hass.states.async_all("tts"))
        tts_entity = tts[0] if tts else None
    if not tts_entity:
        return [{"id": p, "ok": False, "error": "keine Sprachausgabe (TTS) in Home Assistant"} for p in players]
    media = tts_url(tts_entity, message, language)
    for pid in players:
        try:
            data: dict[str, Any] = {"entity_id": pid, "media_content_id": media, "media_content_type": "music", "announce": True}
            if volume is not None:
                data["extra"] = {"volume": max(0.05, min(1.0, float(volume)))}
            await hass.services.async_call("media_player", "play_media", data, blocking=True)
            results.append({"id": pid, "ok": True})
        except Exception as err:  # noqa: BLE001
            _LOGGER.warning("Familienzentrale: Ansage auf %s fehlgeschlagen: %s", pid, err)
            results.append({"id": pid, "ok": False, "error": str(err)})
    return results


def in_quiet(now_hm: str, start: str | None, end: str | None) -> bool:
    """Ruhezeit (z. B. 21:00–07:00), Uhrzeiten als "HH:MM"."""
    if not start or not end or start == end:
        return False
    return start <= now_hm < end if start < end else (now_hm >= start or now_hm < end)

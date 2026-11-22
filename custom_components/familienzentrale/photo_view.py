"""Adresse /api/familienzentrale/foto/<nummer>: verkleinertes Foto für den Bilderrahmen.

Nur mit Anmeldung bzw. signiertem Link (den liefert die Aktion frame_photo).
"""

from __future__ import annotations

from aiohttp import web

from homeassistant.components.http import HomeAssistantView

from . import photos
from .const import DOMAIN


class FamilienzentralePhotoView(HomeAssistantView):
    url = "/api/familienzentrale/foto/{index}"
    name = "api:familienzentrale:foto"
    requires_auth = True

    def __init__(self, hass) -> None:
        self.hass = hass

    async def get(self, request: web.Request, index: str) -> web.Response:
        hubs = [h for h in (self.hass.data.get(DOMAIN) or {}).values() if hasattr(h, "photos")]
        if not hubs or not index.isdigit():
            raise web.HTTPNotFound()
        lib = hubs[0].photos
        i = int(index)
        data = lib.cached(i)
        if data is None:
            path = lib.path(i)
            if path is None:
                raise web.HTTPNotFound()
            try:
                data = await self.hass.async_add_executor_job(photos.shrink, path)
            except Exception as err:  # noqa: BLE001 - kaputtes oder fremdes Bildformat
                raise web.HTTPUnsupportedMediaType(text=str(err)) from err
            lib.remember(i, data)
        return web.Response(body=data, content_type="image/jpeg", headers=photos.photo_response_headers())

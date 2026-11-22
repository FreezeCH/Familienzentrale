"""Bilderrahmen: Fotos aus einem Medienordner von Home Assistant.

Der Ordner liegt unter den HA-Medien (z. B. ein Netzwerkspeicher „Bilder“ mit Verwendung
„Medien“ → /media/Bilder). Die Fotos werden verkleinert ausgeliefert (lange Seite höchstens
1600 Pixel), damit ältere Tablets nicht mit 10-MB-Bildern kämpfen.

Die Auslieferung läuft über eine eigene Adresse mit signiertem Link (wie bei HA-Medien):
die Familienzentrale gibt nur eine Nummer heraus, nie einen Dateipfad.
"""

from __future__ import annotations

import io
import os
import random
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
MAX_FILES = 5000
LIST_TTL = 1800  # Liste 30 Minuten merken
MAX_EDGE = 1600
CACHE_SIZE = 8
LOCAL_PREFIX = "media-source://media_source/local/"


def folder_of(setting: str | None, media_root: str) -> Path | None:
    """Einstellung („Bilder“, „/media/Bilder“ oder media-source://media_source/local/Bilder) → Ordner."""
    s = str(setting or "").strip()
    if not s:
        return None
    if s.startswith(LOCAL_PREFIX):
        s = s[len(LOCAL_PREFIX):]
    elif s.startswith("media-source://"):
        return None  # andere Medienquellen werden nicht unterstützt
    root = Path(media_root).resolve()
    if s.startswith("/media/") or s == "/media":
        s = s[len("/media"):]
    path = (root / s.strip("/")).resolve()
    if path != root and root not in path.parents:
        return None  # nicht ausserhalb der Medien
    return path


def scan(folder: Path) -> list[str]:
    """Alle Bilddateien (rekursiv), gemischt. Blockierend."""
    out: list[str] = []
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = [d for d in dirnames if not d.startswith(".") and d != "@eaDir"]
        for name in filenames:
            if name.startswith("."):
                continue
            if os.path.splitext(name)[1].lower() in EXTENSIONS:
                out.append(os.path.join(dirpath, name))
                if len(out) >= MAX_FILES:
                    break
        if len(out) >= MAX_FILES:
            break
    random.shuffle(out)
    return out


def shrink(path: str, max_edge: int = MAX_EDGE) -> bytes:
    """Foto drehen (EXIF), verkleinern und als JPEG liefern. Blockierend."""
    from PIL import Image, ImageOps  # in Home Assistant vorhanden

    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)
        img.thumbnail((max_edge, max_edge))
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=82, optimize=True)
        return buf.getvalue()


class PhotoLibrary:
    def __init__(self) -> None:
        self._folder: Path | None = None
        self._files: list[str] = []
        self._ts = 0.0
        self._cache: OrderedDict[int, bytes] = OrderedDict()

    def needs_scan(self, folder: Path) -> bool:
        return folder != self._folder or time.monotonic() - self._ts > LIST_TTL

    def set_files(self, folder: Path, files: list[str]) -> None:
        if folder != self._folder:
            self._cache.clear()
        self._folder, self._files, self._ts = folder, files, time.monotonic()

    @property
    def generation(self) -> int:
        return int(self._ts)

    @property
    def count(self) -> int:
        return len(self._files)

    def path(self, index: int) -> str | None:
        if not self._files:
            return None
        return self._files[index % len(self._files)]

    def name(self, index: int) -> str:
        p = self.path(index)
        return os.path.basename(os.path.dirname(p)) if p else ""

    def cached(self, index: int) -> bytes | None:
        data = self._cache.get(index)
        if data is not None:
            self._cache.move_to_end(index)
        return data

    def remember(self, index: int, data: bytes) -> None:
        self._cache[index] = data
        while len(self._cache) > CACHE_SIZE:
            self._cache.popitem(last=False)


def photo_response_headers() -> dict[str, Any]:
    return {"Cache-Control": "private, max-age=600"}

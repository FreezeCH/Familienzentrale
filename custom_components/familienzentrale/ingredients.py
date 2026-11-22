"""Zutaten aus Mealie in einkaufstaugliche Einträge umwandeln (ohne HA-Abhängigkeiten, gut testbar).

Ergebnis je Zutat: {"name": "Schnittlauch", "spec": "1 Bund, fein geschnitten"}
- name: kurz, damit gleiche Lebensmittel zusammenpassen (Bring: Artikelname)
- spec: Menge und Zusatz (Bring: Spezifikation)
"""

from __future__ import annotations

import re
from typing import Any

_NUM = r"(?:\d+(?:[.,]\d+)?(?:\s*/\s*\d+)?|[½¼¾⅓⅔⅛])"
_AMOUNT = rf"(?:ca\.?\s*)?{_NUM}(?:\s*(?:-|–|bis)\s*{_NUM})?"
_UNITS = (
    "EL|TL|KL|g|gr|kg|mg|dl|cl|ml|l|Liter|Bund|Bd\\.?|Prisen?|Msp\\.?|Messerspitzen?|Stk\\.?|Stück|Dosen?|Becher|"
    "Pck\\.?|Päckchen|Packungen?|Pack|Beutel|Zehen?|Scheiben?|Zweige?|Handvoll|Tassen?|Gläser|Glas|Würfel|Blätter|Blatt|"
    "Stangen?|Knollen?|Köpfe|Kopf|cm|Tropfen|Spritzer|Schuss|Flaschen?|Tafeln?|Rollen?"
)
_LEAD = re.compile(rf"^\s*(?P<amount>{_AMOUNT})\s*(?P<unit>(?:{_UNITS})(?=\s|$))?\s*(?P<rest>.*)$", re.IGNORECASE)
# Zusätze, die nicht zum Artikelnamen gehören
_SUFFIX = re.compile(r"\s+(?=(?:zum|zur|für|nach|à|a\s+ca\.|ca\.|je)\s)", re.IGNORECASE)


def _fmt_qty(qty: Any) -> str:
    try:
        q = float(qty)
    except (TypeError, ValueError):
        return ""
    if q <= 0:
        return ""
    return str(int(q)) if q.is_integer() else str(round(q, 2)).rstrip("0").rstrip(".").replace(".", ",")


def _has_letters(text: str) -> bool:
    return any(ch.isalpha() for ch in text)


def parse_text(text: str) -> dict[str, str]:
    """Freitext wie „1 Bund Schnittlauch, fein geschnitten“ zerlegen."""
    text = " ".join(str(text or "").split())
    if not _has_letters(text):
        return {"name": "", "spec": ""}
    amount = unit = ""
    rest = text
    m = _LEAD.match(text)
    if m:
        if not _has_letters(m.group("rest") or ""):
            return {"name": "", "spec": ""}  # nur Menge, z. B. „200 g“
        amount, unit, rest = m.group("amount") or "", m.group("unit") or "", m.group("rest") or ""
    extras = []
    if "," in rest and (amount or unit):
        rest, more = rest.split(",", 1)
        extras.append(more.strip())
    parts = _SUFFIX.split(rest, maxsplit=1)
    name = parts[0].strip(" ,")
    if len(parts) > 1:
        extras.insert(0, parts[1].strip())
    if not _has_letters(name):
        return {"name": "", "spec": ""}
    spec = " ".join(x for x in (amount.strip(), unit.strip()) if x)
    spec = ", ".join(x for x in [spec] + extras if x)
    return {"name": name, "spec": spec}


def ingredient_line(ing: dict) -> dict[str, str]:
    """Zutat aus Mealie -> {"name", "spec"}. Leerer Name = nicht verwendbar."""
    food = ing.get("food") or {}
    unit = ing.get("unit") or {}
    food_name = (food.get("name") if isinstance(food, dict) else "") or ""
    if food_name.strip():
        spec_parts = [_fmt_qty(ing.get("quantity"))]
        if isinstance(unit, dict):
            u = unit.get("abbreviation") if unit.get("use_abbreviation") and unit.get("abbreviation") else unit.get("name")
            spec_parts.append(u or "")
        spec = " ".join(x for x in spec_parts if x)
        note = (ing.get("note") or "").strip()
        if note and note.casefold() != food_name.strip().casefold():
            spec = ", ".join(x for x in (spec, note) if x)
        return {"name": food_name.strip(), "spec": spec}
    # Nicht zerlegte Zutat: vollständigen Text nehmen (Notiz, Originaltext, Anzeige) und selbst zerlegen
    for key in ("note", "original_text", "display"):
        parsed = parse_text(ing.get(key) or "")
        if parsed["name"]:
            return parsed
    return {"name": "", "spec": ""}


def norm(name: str) -> str:
    return " ".join(str(name or "").casefold().split())

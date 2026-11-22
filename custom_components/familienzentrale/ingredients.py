"""Zutaten aus Mealie in einkaufstaugliche Einträge umwandeln (ohne HA-Abhängigkeiten, gut testbar).

Ergebnis je Zutat: {"name": "Schnittlauch", "spec": "1 Bund, fein geschnitten"}
- name: kurz, damit gleiche Lebensmittel zusammenpassen (Bring: Artikelname)
- spec: Menge und Zusatz (Bring: Spezifikation)
"""

from __future__ import annotations

import math
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


_MASS = {"g", "gr", "ml"}
_SPOON = {"el", "tl", "kl", "dl", "cl", "prise", "prisen", "msp", "msp.", "bund", "zehe", "zehen", "scheibe", "scheiben"}


def round_amount(value: float, unit: str) -> float:
    """Hochgerechnete Menge sinnvoll runden: Gramm/Milliliter auf 5 bzw. 10, Löffel & Co. auf halbe,
    Stückzahlen auf halbe Stück aufgerundet."""
    u = (unit or "").casefold().strip()
    if value <= 0:
        return 0
    if u in _MASS:
        step = 5 if value < 100 else 10
        return max(step, round(value / step) * step)
    if u in ("kg", "l", "liter"):
        return round(value * 20) / 20
    if u in _SPOON:
        return max(0.5, round(value * 2) / 2)
    if not u:
        return math.ceil(value * 2 - 1e-9) / 2
    return max(0.25, round(value * 4) / 4)


def _fmt_num(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else str(round(v, 2)).rstrip("0").rstrip(".").replace(".", ",")


_SCALE = re.compile(rf"^(?P<a1>{_NUM})(?:\s*(?P<sep>-|–|bis)\s*(?P<a2>{_NUM}))?(?P<rest>.*)$")


def scale_spec(spec: str, factor: float) -> str:
    """Menge am Anfang der Angabe mit dem Faktor hochrechnen ("150 g, weich" × 2 = "300 g, weich")."""
    if not spec or abs(factor - 1) < 1e-9:
        return spec
    m = _SCALE.match(spec.strip())
    if not m:
        return spec
    rest = m.group("rest") or ""
    unit = rest.strip().split(",")[0].split(" ")[0] if rest.strip() and rest.strip()[0].isalpha() else ""
    a1 = _to_float(m.group("a1"))
    if a1 is None:
        return spec
    out = _fmt_num(round_amount(a1 * factor, unit))
    if m.group("a2"):
        a2 = _to_float(m.group("a2"))
        if a2 is not None:
            out += f" {m.group('sep')} " + _fmt_num(round_amount(a2 * factor, unit))
    return out + rest


def servings_factor(wanted: Any, recipe: dict) -> float:
    """Faktor = gewünschte Personen / Portionen des Rezepts (1, wenn eines davon fehlt)."""
    try:
        want = float(wanted or 0)
    except (TypeError, ValueError):
        want = 0
    base = 0.0
    for key in ("recipe_servings", "recipe_yield_quantity"):
        try:
            base = float(recipe.get(key) or 0)
        except (TypeError, ValueError):
            base = 0
        if base > 0:
            break
    if want <= 0 or base <= 0:
        return 1.0
    return want / base


def ingredient_line(ing: dict, factor: float = 1.0) -> dict[str, str]:
    """Zutat aus Mealie -> {"name", "spec"}, Menge mit dem Faktor hochgerechnet."""
    line = _ingredient_line(ing)
    if line["name"] and line["spec"]:
        line["spec"] = scale_spec(line["spec"], factor)
    return line


def _ingredient_line(ing: dict) -> dict[str, str]:
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


_SPEC = re.compile(rf"^(?P<amount>{_NUM})(?:\s+(?P<unit>[^\s,]+))?(?P<extra>(?:,.*)?)$")


def _to_float(text: str) -> float | None:
    frac = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3, "⅛": 0.125}
    t = text.strip().replace(",", ".")
    if t in frac:
        return frac[t]
    if "/" in t:
        a, b = t.split("/", 1)
        try:
            return float(a) / float(b)
        except (ValueError, ZeroDivisionError):
            return None
    try:
        return float(t)
    except ValueError:
        return None


def combine_specs(specs: list[str]) -> str:
    """Mengen derselben Zutat aus mehreren Rezepten zusammenführen.

    Gleiche Einheit -> addieren ("1,5 dl" + "1,5 dl" = "3 dl"); sonst mit " + " verbinden.
    Zusätze (", fein gehackt") werden ohne Wiederholung angehängt.
    """
    specs = [s.strip() for s in specs if s and s.strip()]
    if not specs:
        return ""
    if len(specs) == 1:
        return specs[0]
    parsed = [_SPEC.match(s) for s in specs]
    if all(parsed):
        units = {(m.group("unit") or "").casefold() for m in parsed}
        amounts = [_to_float(m.group("amount")) for m in parsed]
        if len(units) == 1 and all(a is not None for a in amounts):
            total = sum(amounts)
            num = str(int(total)) if float(total).is_integer() else str(round(total, 2)).rstrip("0").rstrip(".").replace(".", ",")
            unit = parsed[0].group("unit") or ""
            extras: list[str] = []
            for m in parsed:
                for e in (m.group("extra") or "").lstrip(",").split(","):
                    e = e.strip()
                    if e and e not in extras:
                        extras.append(e)
            return ", ".join(x for x in [" ".join(x for x in (num, unit) if x)] + extras if x)
    # nicht addierbar: gleiche Angaben zählen ("2× 1 Bund"), verschiedene verbinden
    out: list[str] = []
    for s in specs:
        if s not in out:
            out.append(s)
    return " + ".join((f"{specs.count(s)}× {s}" if specs.count(s) > 1 else s) for s in out)

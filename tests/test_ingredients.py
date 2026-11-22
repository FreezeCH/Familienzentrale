"""Tests der Zutaten-Zerlegung. Aufruf: python tests/test_ingredients.py"""

import importlib.util
import sys
from pathlib import Path

_path = Path(__file__).resolve().parents[1] / "custom_components" / "familienzentrale" / "ingredients.py"
_spec = importlib.util.spec_from_file_location("fz_ingredients", _path)
ing = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ing)

# Zeilen, wie sie aus Mealie-Rezepten mit Freitext-Zutaten kommen
CASES = {
    "1 - 2 Rüebli, geschält, klein gewürfelt": ("Rüebli", "1 - 2, geschält, klein gewürfelt"),
    "1 Bund Schnittlauch, fein geschnitten": ("Schnittlauch", "1 Bund, fein geschnitten"),
    "1 Bund Estragon": ("Estragon", "1 Bund"),
    "1 EL Tomatenpüree": ("Tomatenpüree", "1 EL"),
    "1 TL Currypulver": ("Currypulver", "1 TL"),
    "1 Zwiebel, fein gehackt": ("Zwiebel", "1, fein gehackt"),
    "1 cl Cognac": ("Cognac", "1 cl"),
    "1 dl Weisswein oder alkoholfreier Apfelwein": ("Weisswein oder alkoholfreier Apfelwein", "1 dl"),
    "1,25 dl Vollrahm": ("Vollrahm", "1,25 dl"),
    "120 g Butter, weich": ("Butter", "120 g, weich"),
    "4 Entrecôtes à ca. 200 g": ("Entrecôtes", "4, à ca. 200 g"),
    "50 g Butter zum Dämpfen": ("Butter", "50 g, zum Dämpfen"),
    "600 g Brätkügeli": ("Brätkügeli", "600 g"),
    "8 Butterblätterteig-Pastetli": ("Butterblätterteig-Pastetli", "8"),
    "Schnittlauch zum Garnieren": ("Schnittlauch", "zum Garnieren"),
    "Salz, Pfeffer": ("Salz, Pfeffer", ""),
    "1 Knoblauchzehe": ("Knoblauchzehe", "1"),
    "½ TL Salz": ("Salz", "½ TL"),
    "200 g": ("", ""),
    "8": ("", ""),
    "": ("", ""),
}


def test_parse_text():
    for text, (name, spec) in CASES.items():
        got = ing.parse_text(text)
        assert (got["name"], got["spec"]) == (name, spec), (text, got)


def test_ingredient_line():
    # zerlegt (Lebensmittel bekannt)
    a = ing.ingredient_line({"quantity": 500, "unit": {"name": "Gramm", "abbreviation": "g", "use_abbreviation": True}, "food": {"name": "Spaghetti"}, "note": ""})
    assert a == {"name": "Spaghetti", "spec": "500 g"}, a
    b = ing.ingredient_line({"quantity": 1.5, "unit": {"name": "dl"}, "food": {"name": "Rahm"}, "note": "Vollrahm"})
    assert b == {"name": "Rahm", "spec": "1,5 dl, Vollrahm"}, b
    # nur Menge, kein Text -> nicht verwendbar
    assert ing.ingredient_line({"quantity": 200, "unit": {"name": "g"}, "food": None, "note": "", "display": "200 g"})["name"] == ""
    # Freitext in der Notiz
    c = ing.ingredient_line({"quantity": 1, "food": None, "note": "1 Bund Petersilie", "display": "1 1 Bund Petersilie"})
    assert c == {"name": "Petersilie", "spec": "1 Bund"}, c
    # Originaltext, wenn die Notiz leer ist
    d = ing.ingredient_line({"quantity": 0, "food": None, "note": "", "original_text": "250 g Rindsvoressen", "display": "250 g"})
    assert d == {"name": "Rindsvoressen", "spec": "250 g"}, d


def test_combine_specs():
    c = ing.combine_specs
    assert c(["1,5 dl", "1,5 dl"]) == "3 dl"
    assert c(["1, fein gehackt", "1, fein gehackt"]) == "2, fein gehackt"
    assert c(["120 g, weich", "50 g, zum Dämpfen"]) == "170 g, weich, zum Dämpfen"
    assert c(["3 EL", "3 EL"]) == "6 EL"
    assert c(["½ TL", "1 TL"]) == "1,5 TL"
    assert c(["1 Bund, fein geschnitten", "zum Garnieren"]) == "1 Bund, fein geschnitten + zum Garnieren"
    assert c(["1 - 2, geschält", "1 - 2, geschält"]) == "2× 1 - 2, geschält"
    assert c(["500 g", "1 kg"]) == "500 g + 1 kg"
    assert c(["", "2"]) == "2"
    assert c([]) == ""


def test_scaling():
    sc = ing.scale_spec
    assert sc("150 g, weich", 2) == "300 g, weich"
    assert sc("1 Bund, fein geschnitten", 1.5) == "1,5 Bund, fein geschnitten"
    assert sc("1, fein gehackt", 1.5) == "1,5, fein gehackt"
    assert sc("1 - 2, geschält", 2) == "2 - 4, geschält"
    assert sc("3 EL", 0.5) == "1,5 EL"
    assert sc("4 dl, kalt", 1.25) == "5 dl, kalt"
    assert sc("8", 1.5) == "12"
    assert sc("1", 0.75) == "1"            # Stück: auf halbe aufrunden
    assert sc("600 g", 0.75) == "450 g"
    assert sc("37 g", 1.5) == "55 g"       # 55,5 -> auf 5 g gerundet
    assert sc("zum Garnieren", 2) == "zum Garnieren"
    assert sc("4, à ca. 200 g", 1.5) == "6, à ca. 200 g"
    f = ing.servings_factor
    assert f(6, {"recipe_servings": 4}) == 1.5
    assert f(4, {"recipe_servings": 0, "recipe_yield_quantity": 2}) == 2
    assert f(4, {}) == 1.0 and f(None, {"recipe_servings": 4}) == 1.0
    line = ing.ingredient_line({"quantity": 500, "unit": {"name": "g"}, "food": {"name": "Spaghetti"}}, 1.5)
    assert line == {"name": "Spaghetti", "spec": "750 g"}, line


def test_norm():
    assert ing.norm("  Schnittlauch ") == ing.norm("schnittlauch")


if __name__ == "__main__":
    fails = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            try:
                fn()
                print("ok  ", name)
            except AssertionError as e:
                fails += 1
                print("FEHLER", name, e)
    sys.exit(1 if fails else 0)

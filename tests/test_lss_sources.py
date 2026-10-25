"""Импорт LSS из обоих источников: longstoryshort.app (Нилон) и
mycharacterbuilder.com (sad). Без сервера: pytest tests/test_lss_sources.py.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from app import dice, sheet_data  # noqa: E402
from app.importers import lss  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures"
NILON = (FIXTURES / "lss_nilon_app.json").read_text(encoding="utf-8")
SAD = (FIXTURES / "lss_sad_mcb.json").read_text(encoding="utf-8")


def parse(raw: str) -> dict:
    return lss.parse(raw)[1]


def test_both_parse_and_pass_sheet_checks():
    for raw, name in ((NILON, "Нилон"), (SAD, "sad")):
        got_name, data = lss.parse(raw)[:2]
        assert got_name == name
        sheet_data.check_value(data)


# --- оружие ------------------------------------------------------------------


def test_damage_split_formula_and_types():
    assert lss._split_damage("1 д8 +4 рубящий +1д6 сияющий") == ("1к8+4+1к6", ["рубящий", "сияющий"])
    assert lss._split_damage("1к8") == ("1к8", [])
    assert lss._split_damage("огромный урон") == (None, ["огромный", "урон"])
    assert lss._split_damage(None) == (None, [])


def test_nilon_sword_of_dawn_rolls():
    sword = next(w for w in parse(NILON)["weapons"] if w["name"] == "Меч рассвета")
    assert sword["damage"] == "1к8+4+1к6"
    assert sword["type"] == "рубящий, сияющий"
    r = dice.roll(sword["damage"])  # бросает тот же парсер, что и сервер
    assert len(r.terms) == 3


def test_nilon_weapon_without_mod_keeps_ability_and_prof():
    longsword = next(w for w in parse(NILON)["weapons"] if w["name"] == "Длинный меч")
    # Атаку не выдумываем: пусто, а ability и владение - для подсказки в листе.
    assert longsword["attack"] is None
    assert longsword["ability"] == "str"
    assert longsword["prof"] is False
    assert longsword["damage"] == "1к8" and longsword["type"] == "рубящий"
    assert "Универсальное" in longsword["notes"]


def test_unrollable_damage_becomes_note():
    raw = json.loads(NILON)
    inner = json.loads(raw["data"])
    inner["weaponsList"][0]["dmg"] = {"value": "как договоримся"}
    raw["data"] = json.dumps(inner, ensure_ascii=False)
    w = parse(json.dumps(raw, ensure_ascii=False))["weapons"][0]
    assert w["damage"] is None
    assert w["notes"].startswith("как договоримся")


def test_sad_weapons_unchanged():
    """mycharacterbuilder.com: mod и урон в порядке - как было до разбора урона."""
    w = parse(SAD)["weapons"]
    assert [(x["name"], x["attack"], x["damage"], x["type"]) for x in w] == [
        ("Цеп", "+10", "1к8+4", "дробящ."),
        ("Двуручный меч", "+10", "2к6+4", "рубящ."),
        ("Метательное копьё", "+10", "1к6+4", "колющ."),
    ]
    assert all(x["ability"] == "str" and x["prof"] is True for x in w)


def test_is_prof_variants():
    for value, expected in ((0, False), (1, True), (True, True), (False, False), (None, False), (2, True)):
        assert lss._prof(value) is expected, value
        assert lss._prof({"value": value}) is expected, value

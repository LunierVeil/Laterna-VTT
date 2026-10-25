"""Импорт LSS из обоих источников: longstoryshort.app (Нилон) и
mycharacterbuilder.com (sad). Без сервера: pytest tests/test_lss_sources.py.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

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


# --- ресурсы ------------------------------------------------------------------


def test_nilon_no_deleted_and_items_not_counters():
    data = parse(NILON)
    counters = [r["name"] for r in data["resources"]]
    items = [c["name"] for c in data["equipment"]]
    # Удалённый "меч рассвета" (isDeleted) не перенесён, живой "меч рассвета*" - есть.
    assert "меч рассвета" not in items + counters
    assert "меч рассвета*" in items
    # Осиротевший дубль "плащь" пропущен, живой - один.
    assert items.count("плащь") == 1
    # Снаряжение - не счётчики.
    assert "Длинный меч" in items and "Длинный меч" not in counters
    assert counters == ["Сражение двумя оружиями."]


def test_item_quantity_and_notes():
    items = {c["name"]: c for c in parse(NILON)["equipment"]}
    assert items["Кольчуга"]["qty"] == 2
    assert "кд 16" in json.dumps(items["Кольчуга"]["doc"], ensure_ascii=False)
    assert items["Ладан"]["doc"] is None


def _with_resources(resources: dict) -> str:
    raw = json.loads(SAD)
    inner = json.loads(raw["data"])
    inner["resources"] = resources
    raw["data"] = json.dumps(inner, ensure_ascii=False)
    return json.dumps(raw, ensure_ascii=False)


def test_duplicates_merged_and_overflow_kept():
    data = parse(_with_resources({
        "a": {"id": "a", "name": "Факел", "current": 2, "location": "equipment", "notes": "горит час"},
        "b": {"id": "b", "name": "факел ", "current": 3, "location": "items"},
        "c": {"id": "c", "name": "Ки", "current": 7, "resolvedMax": 5, "isShortRest": True, "location": "traits"},
        "d": {"id": "d", "name": "Ки", "current": 1, "resolvedMax": 5, "location": "traits"},
        "e": {"id": "e", "name": "Старое", "current": 1, "location": "traits", "isDeleted": True},
    }))
    torches = [c for c in data["equipment"] if c["name"].casefold().strip() == "факел"]
    assert len(torches) == 1 and torches[0]["qty"] == 5
    ki = [r for r in data["resources"] if r["name"] == "Ки"]
    assert len(ki) == 1 and (ki[0]["current"], ki[0]["max"]) == (7, 5)  # больше максимума - как в файле
    assert "Старое" not in [r["name"] for r in data["resources"]]


# --- внешность ----------------------------------------------------------------


def test_sub_info_and_size():
    info = parse(NILON)["info"]
    assert (info["age"], info["height"], info["weight"]) == ("23", "178", "50")
    assert (info["eyes"], info["skin"], info["hair"]) == ("Полностью белые", "бледно-серая", "Черные")
    assert info["size"] == "medium"
    sad = parse(SAD)["info"]
    # У sad subInfo пустой - пустое не переносим.
    assert all(sad[k] is None for k in ("age", "height", "weight", "eyes", "skin", "hair"))
    assert sad["size"] == "small"


def test_prof_text_kept():
    """Текст "Прочие владения и языки" (prof) - карточкой умений."""
    titles = [c["title"] for c in parse(SAD)["features"]]
    assert "Прочие владения и языки" in titles


# --- заголовки текстов ----------------------------------------------------------


def _all_titles(data: dict) -> list[str]:
    return [c.get("title") or c.get("name") for key in ("features", "equipment", "lore") for c in data[key]]


def test_no_raw_text_keys_in_titles():
    for raw in (NILON, SAD):
        titles = _all_titles(parse(raw))
        for key in ("items", "traits", "notes-1", "notes-2", "notes-3", "prof"):
            assert key not in titles, (key, titles)


def test_items_text_goes_to_equipment():
    raw = json.loads(SAD)
    inner = json.loads(raw["data"])
    inner["text"]["items"] = {"value": {"data": {
        "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "верёвка"}]}],
    }}}
    raw["data"] = json.dumps(inner, ensure_ascii=False)
    data = parse(json.dumps(raw, ensure_ascii=False))
    card = next(c for c in data["equipment"] if c["id"] == "lss-items")
    assert card["name"] == "Предметы"
    assert "lss-items" not in [c["id"] for c in data["features"]]


def test_unknown_key_and_duplicate_titles():
    raw = json.loads(SAD)
    inner = json.loads(raw["data"])
    doc = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}]}
    inner["text"]["mystery-block"] = {"value": {"data": doc}}
    inner["text"]["other-block"] = {"value": {"data": doc}}
    inner["text"]["features"]["customLabel"] = "Черты"  # совпадёт с разделом feats
    raw["data"] = json.dumps(inner, ensure_ascii=False)
    titles = [c["title"] for c in parse(json.dumps(raw, ensure_ascii=False))["features"]]
    assert "mystery-block" not in titles and "Записи" in titles and "Записи 2" in titles
    assert len(titles) == len(set(titles)), titles


# --- отчёт импорта --------------------------------------------------------------


def test_report_nilon():
    report = lss.parse_report(NILON)[2]
    assert "оружие 2" in report["done"] and "предметы 23" in report["done"]
    assert "удалённое в LSS: 2" in report["skipped"]


def test_avatar_reported_not_stored():
    """Аватар - внешний адрес: не скачивается и в лист не попадает. В
    образцах его нет (вычищен санитайзером) - подставляем."""
    raw = json.loads(NILON)
    inner = json.loads(raw["data"])
    inner["avatar"] = {"jpeg": "https://hotbox.longstoryshort.app/avatar/x.jpeg"}
    raw["data"] = json.dumps(inner, ensure_ascii=False)
    name, data, report = lss.parse_report(json.dumps(raw, ensure_ascii=False))
    assert "портрет не перенесён, загрузите вручную" in report["skipped"]
    assert "longstoryshort.app/avatar" not in json.dumps(data)


def test_report_sad_clean():
    assert lss.parse_report(SAD)[2]["skipped"] == []


def test_report_counts_non_https_links():
    raw = json.loads(SAD)
    inner = json.loads(raw["data"])
    bad = {"type": "text", "text": "x", "marks": [{"type": "link", "attrs": {"href": "javascript:alert(1)"}}]}
    ok = {"type": "text", "text": "y", "marks": [{"type": "link", "attrs": {"href": "https://ok.example"}}]}
    inner["text"]["features"]["value"]["data"]["content"].append({"type": "paragraph", "content": [bad, ok]})
    raw["data"] = json.dumps(inner, ensure_ascii=False)
    assert "ссылки не https: 1" in lss.parse_report(json.dumps(raw, ensure_ascii=False))[2]["skipped"]


# --- переимпорт ---------------------------------------------------------------


def test_nilon_reimport_keeps_own_edits():
    played = parse(NILON)
    played["about"] = {"story": "своя история"}
    played["skills"]["athletics"] = {**played["skills"].get("athletics", {}), "bonus": 9}
    played["weapons"][0]["attack"] = "+7"  # игрок вписал атаку, которой не было в файле
    played["equipment"].append({"id": "own-rope", "name": "Своя верёвка", "qty": 1})
    played["resources"].append({"name": "Свой счётчик", "current": 1, "max": 3})
    merged = lss.merge_reimport(played, parse(NILON))
    assert merged["about"] == {"story": "своя история"}
    assert merged["skills"]["athletics"]["bonus"] == 9
    assert merged["weapons"][0]["attack"] == "+7"
    assert "Своя верёвка" in [c["name"] for c in merged["equipment"]]
    assert "Свой счётчик" in [r["name"] for r in merged["resources"]]
    names = [c["name"] for c in merged["equipment"]]
    assert len(names) == len(set(names))


# --- все образцы, деньги ----------------------------------------------------------

ALL = {p.stem: p.read_text(encoding="utf-8") for p in sorted(FIXTURES.glob("lss_*.json"))}


def test_all_six_fixtures_import():
    assert len(ALL) == 6, sorted(ALL)
    for stem, raw in ALL.items():
        name, data, report = lss.parse_report(raw)
        sheet_data.check_value(data)
        assert name and report["done"], stem


def test_coins():
    assert parse(ALL["lss_lucius"])["coins"] == {"cp": 22, "sp": 0, "ep": 0, "gp": 205, "pp": 0}
    # Пустое coins - нули, а не пусто.
    assert parse(ALL["lss_lapland"])["coins"] == {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}


def test_death_saves():
    assert parse(ALL["lss_lucius"])["death"] == {"successes": 0, "fails": 0, "dying": False}
    raw = json.loads(ALL["lss_lucius"])
    inner = json.loads(raw["data"])
    inner["vitality"].update({"deathSuccesses": 2, "deathFails": 5, "isDying": True})
    raw["data"] = json.dumps(inner, ensure_ascii=False)
    # Больше трёх провалов в файле - до границы схемы, как и прочие числа.
    assert parse(json.dumps(raw, ensure_ascii=False))["death"] == {"successes": 2, "fails": 3, "dying": True}

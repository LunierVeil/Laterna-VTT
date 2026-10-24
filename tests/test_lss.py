"""Адаптер Long Story Short. Без сервера: python -m unittest discover -s tests -t ."""

from __future__ import annotations

import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from app import sheet_data  # noqa: E402
from app.importers import lss  # noqa: E402

SAMPLE = (Path(__file__).parent / "fixtures" / "lss_sample.json").read_text(encoding="utf-8")


def with_inner(change) -> str:
    """Образец, в котором поправлен внутренний data (он - JSON строкой)."""
    outer = json.loads(SAMPLE)
    inner = json.loads(outer["data"])
    change(inner)
    outer["data"] = json.dumps(inner, ensure_ascii=False)
    return json.dumps(outer, ensure_ascii=False)


class Sample(unittest.TestCase):
    def setUp(self):
        self.name, self.data = lss.parse(SAMPLE)

    def test_name(self):
        self.assertEqual(self.name, "sad")

    def test_vitals(self):
        v = self.data["vitals"]
        self.assertEqual(v["hp"], {"current": 140, "max": 140, "temp": 0})
        self.assertEqual(v["ac"], 16)
        self.assertEqual(v["speed"], "30")
        self.assertEqual(v["initiative"], 3)
        self.assertEqual(v["hit_dice"], "d10")

    def test_abilities_and_saves(self):
        a = self.data["abilities"]
        self.assertEqual(set(a), {"str", "dex", "con", "int", "wis", "cha"})
        for ability in a.values():
            self.assertTrue(1 <= ability["score"] <= 30)
            self.assertIsInstance(ability["save"], bool)

    def test_skills_only_proficiency(self):
        s = self.data["skills"]
        self.assertTrue(s["acrobatics"]["prof"])
        self.assertTrue(s["history"]["prof"])
        self.assertFalse(s["investigation"]["prof"])
        self.assertIn("sleight_of_hand", s)  # "sleight of hand" -> ключ схемы
        # Бонусы навыков адаптер не считает - это правило, а не перенос.
        self.assertTrue(all(set(v) == {"prof"} for v in s.values()))

    def test_weapons(self):
        w = self.data["weapons"]
        self.assertEqual(len(w), 3)
        self.assertEqual(w[0], {"name": "Цеп", "attack": "+10", "damage": "1к8+4", "type": "дробящ."})

    def test_resources(self):
        r = self.data["resources"]
        self.assertEqual(len(r), 5)
        first = r[0]
        self.assertEqual(first["name"], "Второе дыхание")
        self.assertEqual((first["current"], first["max"], first["rest"]), (4, 4, "long"))
        self.assertTrue(first["id"].startswith("resource-"))
        self.assertEqual({x["rest"] for x in r}, {"long", "short"})

    def test_texts_whitelisted(self):
        texts = self.data["texts"]
        self.assertTrue(texts)
        allowed = {"doc", "paragraph", "text", "hardBreak", "heading", "bulletList", "orderedList", "listItem", "resource"}
        seen = set()

        def walk(node):
            seen.add(node["type"])
            self.assertLessEqual(set(node), {"type", "text", "marks", "attrs", "content"})
            for m in node.get("marks", []):
                self.assertIn(m["type"], {"bold", "italic"})
            for c in node.get("content", []):
                walk(c)

        for entry in texts.values():
            self.assertTrue(entry["label"])
            walk(entry["doc"])
        self.assertLessEqual(seen, allowed)
        self.assertIn("resource", seen)

    def test_empty_texts_skipped(self):
        def has_text(node):
            if node["type"] == "text":
                return bool(node["text"].strip())
            return node["type"] == "resource" or any(has_text(c) for c in node.get("content", []))

        for key, entry in self.data["texts"].items():
            self.assertTrue(has_text(entry["doc"]), key)
        self.assertNotIn("ideals", self.data["texts"])  # в образце пустой

    def test_known_labels(self):
        labels = {k: v["label"] for k, v in self.data["texts"].items()}
        for key in ("feats", "appearance", "notes-2", "notes-3"):
            if key in labels:
                self.assertNotEqual(labels[key], key)

    def test_passes_sheet_checks(self):
        # Что отдаёт адаптер, должно проходить ту же проверку формы, что и правки.
        sheet_data.check_value(self.data)
        sheet_data.dump(self.data)

    def test_edition_kept(self):
        self.assertEqual(self.data["import"]["edition"], "2024")


class Limits(unittest.TestCase):
    def test_out_of_range_clamped(self):
        def change(inner):
            inner["stats"]["con"]["score"] = 99
            inner["info"]["level"]["value"] = 40
            inner["vitality"]["ac"]["value"] = 500

        _, data = lss.parse(with_inner(change))
        self.assertEqual(data["abilities"]["con"]["score"], 30)
        self.assertEqual(data["info"]["level"], 20)
        self.assertEqual(data["vitals"]["ac"], 40)


class Errors(unittest.TestCase):
    def assertFails(self, raw, part):
        with self.assertRaises(lss.LssError) as ctx:
            lss.parse(raw)
        self.assertIn(part, str(ctx.exception))

    def test_not_json(self):
        self.assertFails("{не json", "не JSON")

    def test_wrong_type(self):
        outer = json.loads(SAMPLE)
        outer["jsonType"] = "spell"
        self.assertFails(json.dumps(outer), "jsonType")

    def test_unknown_version(self):
        outer = json.loads(SAMPLE)
        outer["version"] = "3"
        self.assertFails(json.dumps(outer), "'3' не поддерживается")

    def test_broken_inner(self):
        outer = json.loads(SAMPLE)
        outer["data"] = "{оборвано"
        self.assertFails(json.dumps(outer), "data повреждено")

    def test_too_big(self):
        self.assertFails(" " * (lss.MAX_BYTES + 1), "КБ")

    def test_empty(self):
        self.assertFails("", "пустой")


class Hostile(unittest.TestCase):
    """Файл присылает игрок, текст увидит вся кампания."""

    def test_unknown_nodes_and_marks_dropped(self):
        evil = {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [
                    {"type": "text", "text": "ok", "marks": [
                        {"type": "bold"},
                        {"type": "link", "attrs": {"href": "javascript:alert(1)"}},
                    ]},
                    {"type": "html", "text": "<img src=x onerror=alert(1)>"},
                    {"type": "image", "attrs": {"src": "https://evil.example/x.png"}},
                ]},
                {"type": "iframe", "attrs": {"src": "https://evil.example"}},
                {"type": "paragraph", "attrs": {"onclick": "alert(1)"}, "content": [{"type": "text", "text": "x"}]},
                {"type": "resource", "attrs": {"id": "\"><script>", "textName": "x"}},
            ],
        }

        def change(inner):
            inner["text"]["features"]["value"]["data"] = evil

        _, data = lss.parse(with_inner(change))
        doc = data["texts"]["features"]["doc"]
        dumped = json.dumps(doc)
        for bad in ("javascript", "onerror", "evil.example", "onclick", "script", "html", "iframe", "image", "link"):
            self.assertNotIn(bad, dumped, bad)
        first = doc["content"][0]["content"][0]
        self.assertEqual(first, {"type": "text", "text": "ok", "marks": [{"type": "bold"}]})

    def test_deep_nesting_cut(self):
        node = {"type": "text", "text": "глубоко"}
        for _ in range(50):
            node = {"type": "paragraph", "content": [node]}
        cleaned = lss.clean_doc({"type": "doc", "content": [node]})
        self.assertNotIn("глубоко", json.dumps(cleaned, ensure_ascii=False))

    def test_original_untouched(self):
        before = copy.deepcopy(SAMPLE)
        lss.parse(SAMPLE)
        self.assertEqual(before, SAMPLE)


if __name__ == "__main__":
    unittest.main()

"""Проверка формы данных листа. Без сервера: python -m unittest discover -s tests -t ."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from app import sheet_data  # noqa: E402


class Docs(unittest.TestCase):
    """Описание из редактора проходит тот же белый список, что и импорт."""

    def test_doc_in_card_cleaned(self):
        card = {
            "id": "x",
            "name": "Меч",
            "doc": {"type": "doc", "content": [
                {"type": "paragraph", "content": [
                    {"type": "text", "text": "острый", "marks": [{"type": "bold"}, {"type": "link", "attrs": {"href": "javascript:alert(1)"}}]},
                    {"type": "image", "attrs": {"src": "https://evil.example/x.png"}},
                ]},
            ]},
        }
        data = sheet_data.apply_set({}, {"equipment": [card]})
        dumped = json.dumps(data)
        self.assertNotIn("javascript", dumped)
        self.assertNotIn("evil.example", dumped)
        self.assertEqual(
            data["equipment"][0]["doc"]["content"][0]["content"],
            [{"type": "text", "text": "острый", "marks": [{"type": "bold"}]}],
        )
        self.assertEqual(data["equipment"][0]["name"], "Меч")

    def test_plain_values_untouched(self):
        data = sheet_data.apply_set({}, {"vitals.hp.current": 12, "notes": "<b>текст</b>"})
        self.assertEqual(data["vitals"]["hp"]["current"], 12)
        self.assertEqual(data["notes"], "<b>текст</b>")  # обычная строка, рисуется как текст

    def test_bad_path(self):
        with self.assertRaises(sheet_data.SheetError):
            sheet_data.apply_set({}, {"a..b": 1})


if __name__ == "__main__":
    unittest.main()

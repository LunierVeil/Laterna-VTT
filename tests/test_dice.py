"""Парсер кубов. Без сервера: python -m unittest discover -s tests -t ."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server"))

from app import dice  # noqa: E402


class RussianK(unittest.TestCase):
    """В LSS урон записан с русской "к": 1к8+4."""

    def test_lss_damage(self):
        r = dice.roll("1к8+4")
        self.assertEqual(len(r.terms), 2)
        die, flat = r.terms
        self.assertEqual(die.kind, "dice")
        self.assertEqual(len(die.rolls), 1)
        self.assertTrue(1 <= die.rolls[0] <= 8)
        self.assertEqual(flat.value, 4)
        self.assertEqual(r.total, die.rolls[0] + 4)
        # В результате - формула как её прислали, с "к".
        self.assertEqual(r.formula, "1к8+4")

    def test_capital_and_spaces(self):
        r = dice.roll("2К6 + 1")
        self.assertEqual(len(r.terms[0].rolls), 2)
        self.assertTrue(3 <= r.total <= 13)

    def test_keep_highest_with_k(self):
        # kh - латиница, "к" - кириллица: одно не ломает другое.
        r = dice.roll("4к6kh3")
        self.assertEqual(len(r.terms[0].rolls), 4)
        self.assertEqual(len(r.terms[0].kept), 3)

    def test_cyrillic_d(self):
        # longstoryshort.app пишет "1 д8 +4": "д" - как "к" и "d".
        r = dice.roll("1 д8 +4")
        self.assertEqual(len(r.terms), 2)
        self.assertTrue(1 <= r.terms[0].rolls[0] <= 8)
        self.assertEqual(r.terms[1].value, 4)
        self.assertEqual(len(dice.roll("2Д6").terms[0].rolls), 2)
        self.assertEqual(len(dice.roll("1д8+1к6+1d4").terms), 3)

    def test_chat_command(self):
        self.assertEqual(dice.parse_chat("/r 1к20+5"), "1к20+5")
        self.assertEqual(dice.roll(dice.parse_chat("/r 1к20+5")).terms[1].value, 5)

    def test_latin_unchanged(self):
        r = dice.roll("2d20kl1")
        self.assertEqual(len(r.terms[0].kept), 1)

    def test_junk_still_rejected(self):
        for bad in ("1к", "к", "1кк8", "1к8+абв"):
            with self.assertRaises(dice.DiceError, msg=bad):
                dice.roll(bad)


if __name__ == "__main__":
    unittest.main()

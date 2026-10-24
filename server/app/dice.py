"""Парсер и бросок кубов.

Броски считаются ТОЛЬКО здесь, на сервере. Клиент присылает строку,
получает результат. Если дать клиенту бросать самому, любой игрок
с девтулзами будет крутить d20 как захочет.

Поддержано: 2d6+3, d20, 4d6kh3 (keep highest), 2d20kl1 (keep lowest),
несколько слагаемых: 1d8+1d6+2. Русская "к" вместо "d" - тоже: так урон
записан в листах Long Story Short ("1к8+4").
"""

from __future__ import annotations

import re
import secrets
from dataclasses import dataclass, field

MAX_DICE = 100
MAX_SIDES = 1000

_TERM = re.compile(
    r"(?P<sign>[+-])?\s*"
    r"(?:(?P<count>\d*)d(?P<sides>\d+)(?:(?P<keep>kh|kl)(?P<keep_n>\d+))?|(?P<flat>\d+))",
    re.IGNORECASE,
)


class DiceError(ValueError):
    pass


@dataclass
class Term:
    sign: int
    kind: str  # "dice" | "flat"
    text: str
    rolls: list[int] = field(default_factory=list)
    kept: list[int] = field(default_factory=list)
    value: int = 0


@dataclass
class RollResult:
    formula: str
    total: int
    terms: list[Term]

    def to_dict(self) -> dict:
        return {
            "formula": self.formula,
            "total": self.total,
            "terms": [
                {
                    "text": t.text,
                    "sign": t.sign,
                    "kind": t.kind,
                    "rolls": t.rolls,
                    "kept": t.kept,
                    "value": t.value,
                }
                for t in self.terms
            ],
        }


def _roll_die(sides: int) -> int:
    # secrets, а не random: броски должны быть непредсказуемы,
    # а seed процесса - не тем, что определяет исход боя.
    return secrets.randbelow(sides) + 1


def roll(formula: str) -> RollResult:
    # "к" - кириллица, только как разделитель кубов. kh/kl - латиница,
    # их это не задевает.
    raw = formula.strip().lower().replace(" ", "").replace("к", "d")
    if not raw:
        raise DiceError("пустая формула")
    if len(raw) > 100:
        raise DiceError("формула слишком длинная")

    pos = 0
    terms: list[Term] = []
    total = 0

    while pos < len(raw):
        m = _TERM.match(raw, pos)
        if not m or m.end() == pos:
            raise DiceError(f"не понимаю формулу начиная с {raw[pos:]!r}")
        pos = m.end()

        sign = -1 if m.group("sign") == "-" else 1

        if m.group("flat") is not None:
            value = int(m.group("flat"))
            terms.append(Term(sign=sign, kind="flat", text=m.group(0), value=value))
            total += sign * value
            continue

        count = int(m.group("count") or 1)
        sides = int(m.group("sides"))
        if count < 1 or count > MAX_DICE:
            raise DiceError(f"количество кубов должно быть 1..{MAX_DICE}")
        if sides < 2 or sides > MAX_SIDES:
            raise DiceError(f"граней должно быть 2..{MAX_SIDES}")

        rolls = [_roll_die(sides) for _ in range(count)]
        kept = list(rolls)

        keep = m.group("keep")
        if keep:
            n = int(m.group("keep_n"))
            if n < 1 or n > count:
                raise DiceError("нельзя оставить больше кубов, чем брошено")
            kept = sorted(rolls, reverse=(keep == "kh"))[:n]

        value = sum(kept)
        terms.append(
            Term(sign=sign, kind="dice", text=m.group(0), rolls=rolls, kept=kept, value=value)
        )
        total += sign * value

    if not terms:
        raise DiceError("пустая формула")

    return RollResult(formula=formula.strip(), total=total, terms=terms)


_COMMAND = re.compile(r"^/(r|roll)\s+(?P<formula>.+)$", re.IGNORECASE)


def parse_chat(text: str) -> str | None:
    """Вернуть формулу, если сообщение - это команда броска."""
    m = _COMMAND.match(text.strip())
    return m.group("formula") if m else None

"""Ручной туман: прямоугольники в пикселях сцены. Чистые функции, без базы.

Туман - список прямоугольников {id, x, y, w, h}; они могут перекрываться.
Открыть область - вычесть прямоугольник из каждого: старый распадается
на остатки (до четырёх: полосы сверху и снизу, куски слева и справа).
Касание краями - не пересечение: открытый край соседнего прямоугольника
не трогает.
"""

from __future__ import annotations

import secrets

MAX_RECTS = 400


def new_id() -> str:
    return f"f-{secrets.token_hex(5)}"


def make(x: float, y: float, w: float, h: float, rid: str | None = None) -> dict:
    return {"id": rid or new_id(), "x": x, "y": y, "w": w, "h": h}


def overlaps(a: dict, b: dict) -> bool:
    """Есть ли общая площадь (только касание краями - нет)."""
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def subtract(r: dict, cut: dict) -> list[dict]:
    """r минус cut: r целиком, если не пересекаются; иначе до четырёх остатков."""
    if not overlaps(r, cut):
        return [r]
    rx2, ry2 = r["x"] + r["w"], r["y"] + r["h"]
    cx2, cy2 = cut["x"] + cut["w"], cut["y"] + cut["h"]
    top, bottom = max(r["y"], cut["y"]), min(ry2, cy2)
    pieces = []
    if cut["y"] > r["y"]:  # полоса сверху на всю ширину
        pieces.append(make(r["x"], r["y"], r["w"], cut["y"] - r["y"]))
    if cy2 < ry2:  # полоса снизу на всю ширину
        pieces.append(make(r["x"], cy2, r["w"], ry2 - cy2))
    if cut["x"] > r["x"]:  # слева - только по высоте пересечения
        pieces.append(make(r["x"], top, cut["x"] - r["x"], bottom - top))
    if cx2 < rx2:  # справа
        pieces.append(make(cx2, top, rx2 - cx2, bottom - top))
    return pieces


def reveal(rects: list[dict], cut: dict) -> list[dict]:
    return [piece for r in rects for piece in subtract(r, cut)]


def contains_point(rects: list[dict], x: float, y: float) -> bool:
    """Точка под туманом. Край - тоже под туманом: токен ровно на границе
    закрытой комнаты не должен выглядывать."""
    return any(r["x"] <= x <= r["x"] + r["w"] and r["y"] <= y <= r["y"] + r["h"] for r in rects)


def covers_segment(rects: list[dict], x1: float, y1: float, x2: float, y2: float) -> bool:
    """Отрезок (стена) целиком под туманом: оба конца и середина. Стена на
    границе открытой и закрытой части остаётся видна - она и так у края."""
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    return all(contains_point(rects, px, py) for px, py in ((x1, y1), (x2, y2), (mx, my)))


def area(rects: list[dict]) -> float:
    """Площадь объединения (для тестов): разбиваем на непересекающиеся куски."""
    disjoint: list[dict] = []
    for r in rects:
        pieces = [r]
        for d in disjoint:
            pieces = [p for piece in pieces for p in subtract(piece, d)]
        disjoint.extend(pieces)
    return sum(p["w"] * p["h"] for p in disjoint)

"""Геометрия, нужная серверу.

Сервер не считает полигоны видимости - это работа клиента. Но
валидация движения обязана быть здесь: иначе игрок просто шлёт
token.move сквозь стену и сервер покорно соглашается.
"""

from __future__ import annotations


def _orient(ax: float, ay: float, bx: float, by: float, cx: float, cy: float) -> float:
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def segments_intersect(
    ax: float, ay: float, bx: float, by: float,
    cx: float, cy: float, dx: float, dy: float,
    eps: float = 1e-9,
) -> bool:
    """Пересекаются ли отрезки AB и CD. Касание концами считается пересечением."""
    d1 = _orient(cx, cy, dx, dy, ax, ay)
    d2 = _orient(cx, cy, dx, dy, bx, by)
    d3 = _orient(ax, ay, bx, by, cx, cy)
    d4 = _orient(ax, ay, bx, by, dx, dy)

    if ((d1 > eps and d2 < -eps) or (d1 < -eps and d2 > eps)) and (
        (d3 > eps and d4 < -eps) or (d3 < -eps and d4 > eps)
    ):
        return True

    def on_segment(px, py, qx, qy, rx, ry) -> bool:
        return (
            min(px, qx) - eps <= rx <= max(px, qx) + eps
            and min(py, qy) - eps <= ry <= max(py, qy) + eps
        )

    if abs(d1) <= eps and on_segment(cx, cy, dx, dy, ax, ay):
        return True
    if abs(d2) <= eps and on_segment(cx, cy, dx, dy, bx, by):
        return True
    if abs(d3) <= eps and on_segment(ax, ay, bx, by, cx, cy):
        return True
    if abs(d4) <= eps and on_segment(ax, ay, bx, by, dx, dy):
        return True
    return False


def path_blocked(x1: float, y1: float, x2: float, y2: float, walls) -> bool:
    """Пересекает ли путь токена хоть одну блокирующую движение стену."""
    for w in walls:
        if not w.blocks_movement:
            continue
        if w.kind == "door" and w.door_state == "open":
            continue
        if segments_intersect(x1, y1, x2, y2, w.x1, w.y1, w.x2, w.y2):
            return True
    return False

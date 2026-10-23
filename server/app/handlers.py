"""Применение команд. Единственное место, где меняется состояние сцены.

Контракт каждого хендлера: получить сессию, сцену и payload, провести
валидацию, изменить БД, вернуть (event_name, event_payload). Инкремент
seq и рассылка - снаружи, в main.py, под локом сцены.

Если хендлер кидает CommandError, клиенту уходит error и его
оптимистичное изменение откатывается.
"""

from __future__ import annotations

import json
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import dice
from .geometry import path_blocked
from .models import Message, Scene, Token, Wall


class CommandError(Exception):
    pass


def _num(payload: dict, key: str, default=None) -> float:
    value = payload.get(key, default)
    if value is None:
        raise CommandError(f"не хватает поля {key}")
    try:
        return float(value)
    except (TypeError, ValueError):
        raise CommandError(f"поле {key} должно быть числом")


def _clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


def _require_owner(obj: Token | Wall, user: str, message: str) -> None:
    # Менять и удалять можно только своё. Чужое - отдельная механика
    # с правами (ГМ), её пока нет. Объект без владельца - общий.
    if obj.owner is not None and obj.owner != user:
        raise CommandError(message)


async def token_add(db: AsyncSession, scene: Scene, user: str, payload: dict):
    token = Token(
        scene_id=scene.id,
        name=str(payload.get("name") or "Токен")[:200],
        x=_clamp(_num(payload, "x", 0), 0, scene.width),
        y=_clamp(_num(payload, "y", 0), 0, scene.height),
        size=_clamp(float(payload.get("size") or 1), 0.25, 10),
        color=str(payload.get("color") or "#c75c5c")[:20],
        image_url=payload.get("image_url"),
        layer="gm" if payload.get("layer") == "gm" else "tokens",
        owner=payload.get("owner") or user,
    )
    db.add(token)
    await db.flush()
    return "token.added", {"token": token.to_dict()}


async def token_move(db: AsyncSession, scene: Scene, user: str, payload: dict):
    token_id = payload.get("id")
    token = await db.get(Token, token_id) if token_id else None
    if token is None or token.scene_id != scene.id:
        raise CommandError("токен не найден")

    nx = _clamp(_num(payload, "x"), 0, scene.width)
    ny = _clamp(_num(payload, "y"), 0, scene.height)

    walls = (await db.execute(select(Wall).where(Wall.scene_id == scene.id))).scalars().all()
    if path_blocked(token.x, token.y, nx, ny, walls):
        raise CommandError("стена на пути")

    token.x, token.y = nx, ny
    await db.flush()
    return "token.moved", {"id": token.id, "x": token.x, "y": token.y}


async def token_update(db: AsyncSession, scene: Scene, user: str, payload: dict):
    token = await db.get(Token, payload.get("id"))
    if token is None or token.scene_id != scene.id:
        raise CommandError("токен не найден")
    # Без этой проверки чужой игрок переписал бы owner на себя и удалил токен.
    _require_owner(token, user, "нельзя менять чужой токен")
    if "name" in payload:
        name = str(payload["name"] or "").strip()
        if not name:
            raise CommandError("пустое имя")
        token.name = name[:200]
    if "color" in payload:
        color = str(payload["color"])
        if not re.fullmatch(r"#[0-9a-fA-F]{6}", color):
            raise CommandError("цвет должен быть вида #rrggbb")
        token.color = color.lower()
    for field in ("image_url", "owner"):
        if field in payload:
            setattr(token, field, payload[field])
    if "size" in payload:
        token.size = _clamp(float(payload["size"]), 0.25, 10)
    await db.flush()
    return "token.updated", {"token": token.to_dict()}


async def token_remove(db: AsyncSession, scene: Scene, user: str, payload: dict):
    token = await db.get(Token, payload.get("id"))
    if token is None or token.scene_id != scene.id:
        raise CommandError("токен не найден")
    _require_owner(token, user, "нельзя удалить чужой токен")
    await db.delete(token)
    await db.flush()
    return "token.removed", {"id": payload["id"]}


async def wall_add(db: AsyncSession, scene: Scene, user: str, payload: dict):
    wall = Wall(
        scene_id=scene.id,
        x1=_num(payload, "x1"),
        y1=_num(payload, "y1"),
        x2=_num(payload, "x2"),
        y2=_num(payload, "y2"),
        kind=str(payload.get("kind") or "wall")[:20],
        door_state=str(payload.get("door_state") or "closed")[:20],
        blocks_movement=bool(payload.get("blocks_movement", True)),
        blocks_sight=bool(payload.get("blocks_sight", True)),
        blocks_sound=bool(payload.get("blocks_sound", False)),
        owner=user,
    )
    if (wall.x1, wall.y1) == (wall.x2, wall.y2):
        raise CommandError("стена нулевой длины")
    db.add(wall)
    await db.flush()
    return "wall.added", {"wall": wall.to_dict()}


async def wall_remove(db: AsyncSession, scene: Scene, user: str, payload: dict):
    wall = await db.get(Wall, payload.get("id"))
    if wall is None or wall.scene_id != scene.id:
        raise CommandError("стена не найдена")
    _require_owner(wall, user, "нельзя удалить чужую стену")
    await db.delete(wall)
    await db.flush()
    return "wall.removed", {"id": payload["id"]}


async def scene_update(db: AsyncSession, scene: Scene, user: str, payload: dict):
    if "grid_size" in payload:
        scene.grid_size = int(_clamp(_num(payload, "grid_size"), 10, 400))
    if "name" in payload:
        scene.name = str(payload["name"])[:200]
    if "background_url" in payload:
        scene.background_url = payload["background_url"]
    await db.flush()
    return "scene.updated", {
        "grid_size": scene.grid_size,
        "name": scene.name,
        "background_url": scene.background_url,
    }


async def chat_say(db: AsyncSession, scene: Scene, user: str, payload: dict):
    text = str(payload.get("text") or "").strip()
    if not text:
        raise CommandError("пустое сообщение")
    if len(text) > 2000:
        raise CommandError("слишком длинное сообщение")

    formula = dice.parse_chat(text)
    if formula:
        try:
            result = dice.roll(formula)
        except dice.DiceError as exc:
            raise CommandError(str(exc))
        message = Message(
            scene_id=scene.id,
            author=user,
            text=formula,
            kind="roll",
            roll_json=json.dumps(result.to_dict(), ensure_ascii=False),
        )
    else:
        message = Message(scene_id=scene.id, author=user, text=text, kind="text")

    db.add(message)
    await db.flush()
    return "chat.said", {"message": message.to_dict()}


HANDLERS = {
    "token.add": token_add,
    "token.move": token_move,
    "token.update": token_update,
    "token.remove": token_remove,
    "wall.add": wall_add,
    "wall.remove": wall_remove,
    "scene.update": scene_update,
    "chat.say": chat_say,
}

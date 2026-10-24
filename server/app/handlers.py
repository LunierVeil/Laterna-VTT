"""Применение команд. Единственное место, где меняется состояние.

Контракт каждого хендлера: получить сессию, сцену и payload, провести
валидацию, изменить БД, вернуть (event_name, event_payload). Инкремент
seq и рассылка - снаружи, в main.py, под локом сцены.

Команды кампании (CAMPAIGN_HANDLERS) получают вместо сцены кампанию:
чат и список сцен общие, seq сцены они не трогают. Рассылает их main.py.

Если хендлер кидает CommandError, клиенту уходит error и его
оптимистичное изменение откатывается.
"""

from __future__ import annotations

import json
import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import dice
from .config import MAX_SCENE_SIDE, UPLOAD_DIR
from .geometry import path_blocked
from .models import Campaign, Message, Scene, Token, Wall
from .roles import Actor


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


_UPLOAD_URL = re.compile(r"/uploads/(?P<name>[0-9a-f]{32}\.(?:png|jpg|webp))")


def _upload_url(value, what: str) -> str | None:
    """Картинка - только то, что загружено через /api/uploads, или ничего.

    Произвольный URL заставил бы браузеры всех игроков ходить на чужой
    сервер: трекинг, подмена картинки, а для не-картинок и хуже.
    """
    if value is None:
        return None
    m = _UPLOAD_URL.fullmatch(str(value))
    if not m or not (UPLOAD_DIR / m.group("name")).is_file():
        raise CommandError(f"{what} - только загруженная картинка")
    return m.group(0)


def _require_gm(actor: Actor, message: str = "это может только ГМ") -> None:
    if not actor.is_gm:
        raise CommandError(message)


def _require_owner(obj: Token | Wall, actor: Actor, message: str) -> None:
    # Своё может менять владелец, чужое - только ГМ: он ведёт партию и
    # убирает за всеми. Объект без владельца - общий.
    if actor.is_gm:
        return
    if obj.owner is not None and obj.owner != actor.name:
        raise CommandError(message)


async def token_add(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    token = Token(
        scene_id=scene.id,
        name=str(payload.get("name") or "Токен")[:200],
        x=_clamp(_num(payload, "x", 0), 0, scene.width),
        y=_clamp(_num(payload, "y", 0), 0, scene.height),
        size=_clamp(float(payload.get("size") or 1), 0.25, 10),
        color=str(payload.get("color") or "#c75c5c")[:20],
        image_url=_upload_url(payload.get("image_url"), "картинка токена"),
        layer="gm" if payload.get("layer") == "gm" else "tokens",
        # Чужое имя владельцем может поставить только ГМ: иначе игрок
        # создавал бы токены от имени другого.
        owner=(payload.get("owner") if actor.is_gm else None) or actor.name,
    )
    db.add(token)
    await db.flush()
    return "token.added", {"token": token.to_dict()}


async def token_move(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    token_id = payload.get("id")
    token = await db.get(Token, token_id) if token_id else None
    if token is None or token.scene_id != scene.id:
        raise CommandError("токен не найден")
    # Своего персонажа двигает игрок, чужого - только ГМ.
    _require_owner(token, actor, "нельзя двигать чужой токен")

    nx = _clamp(_num(payload, "x"), 0, scene.width)
    ny = _clamp(_num(payload, "y"), 0, scene.height)

    walls = (await db.execute(select(Wall).where(Wall.scene_id == scene.id))).scalars().all()
    if path_blocked(token.x, token.y, nx, ny, walls):
        raise CommandError("стена на пути")

    token.x, token.y = nx, ny
    await db.flush()
    return "token.moved", {"id": token.id, "x": token.x, "y": token.y}


async def token_update(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    token = await db.get(Token, payload.get("id"))
    if token is None or token.scene_id != scene.id:
        raise CommandError("токен не найден")
    # Без этой проверки чужой игрок переписал бы owner на себя и удалил токен.
    _require_owner(token, actor, "нельзя менять чужой токен")
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
    if "image_url" in payload:
        token.image_url = _upload_url(payload["image_url"], "картинка токена")
    if "owner" in payload:
        # Отдать токен другому - решение мастера. Иначе игрок "подарил" бы
        # свой токен кому-то или сделал его общим (owner = null), и его
        # смог бы двигать и удалять любой.
        _require_gm(actor, "менять владельца может только ГМ")
        owner = payload["owner"]
        token.owner = None if owner is None else str(owner).strip()[:100] or None
    if "size" in payload:
        size = _clamp(_num(payload, "size"), 0.25, 10)
        # Держим на месте левый верхний угол, а не центр: иначе токен 2x2
        # встанет центром в клетку и съедет с сетки на полклетки.
        shift = (size - token.size) * scene.grid_size / 2
        token.x = _clamp(token.x + shift, 0, scene.width)
        token.y = _clamp(token.y + shift, 0, scene.height)
        token.size = size
    await db.flush()
    return "token.updated", {"token": token.to_dict()}


async def token_remove(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    token = await db.get(Token, payload.get("id"))
    if token is None or token.scene_id != scene.id:
        raise CommandError("токен не найден")
    _require_owner(token, actor, "нельзя удалить чужой токен")
    await db.delete(token)
    await db.flush()
    return "token.removed", {"id": payload["id"]}


async def wall_add(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
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
        owner=actor.name,
    )
    if (wall.x1, wall.y1) == (wall.x2, wall.y2):
        raise CommandError("стена нулевой длины")
    db.add(wall)
    await db.flush()
    return "wall.added", {"wall": wall.to_dict()}


async def wall_remove(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    wall = await db.get(Wall, payload.get("id"))
    if wall is None or wall.scene_id != scene.id:
        raise CommandError("стена не найдена")
    _require_owner(wall, actor, "нельзя удалить чужую стену")
    await db.delete(wall)
    await db.flush()
    return "wall.removed", {"id": payload["id"]}


async def scene_update(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    if not actor.is_gm:
        raise CommandError("сцену меняет только ГМ")
    if "grid_size" in payload:
        scene.grid_size = int(_clamp(_num(payload, "grid_size"), 10, 400))
    if "name" in payload:
        scene.name = str(payload["name"])[:200]
    if "background_url" in payload:
        scene.background_url = _upload_url(payload["background_url"], "фон")
    if "width" in payload:
        scene.width = int(_clamp(_num(payload, "width"), 100, MAX_SCENE_SIDE))
    if "height" in payload:
        scene.height = int(_clamp(_num(payload, "height"), 100, MAX_SCENE_SIDE))
    await db.flush()
    return "scene.updated", {
        "grid_size": scene.grid_size,
        "name": scene.name,
        "background_url": scene.background_url,
        "width": scene.width,
        "height": scene.height,
    }


async def chat_say(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
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
            campaign_id=campaign.id,
            author=actor.name,
            text=formula,
            kind="roll",
            roll_json=json.dumps(result.to_dict(), ensure_ascii=False),
        )
    else:
        message = Message(campaign_id=campaign.id, author=actor.name, text=text, kind="text")

    db.add(message)
    await db.flush()
    return "chat.said", {"message": message.to_dict()}


async def _campaign_scene(db: AsyncSession, campaign: Campaign, payload: dict) -> Scene:
    scene = await db.get(Scene, payload.get("id")) if payload.get("id") else None
    if scene is None or scene.campaign_id != campaign.id:
        raise CommandError("сцена не найдена")
    return scene


async def scene_create(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    _require_gm(actor)
    name = str(payload.get("name") or "").strip()[:200] or "Новая сцена"
    scene = Scene(campaign_id=campaign.id, name=name)
    db.add(scene)
    await db.flush()
    # Новая сцена скрыта: игрокам её покажет только scene.activate.
    return "scene.created", {"id": scene.id}


async def scene_activate(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    _require_gm(actor)
    scene = await _campaign_scene(db, campaign, payload)
    campaign.active_scene_id = scene.id
    await db.flush()
    return "scene.activated", {"id": scene.id}


async def scene_delete(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    _require_gm(actor)
    scene = await _campaign_scene(db, campaign, payload)
    if scene.id == campaign.active_scene_id:
        # Иначе игрокам некуда деваться. Сначала покажи им другую сцену.
        raise CommandError("эту сцену сейчас видят игроки - сначала покажи другую")
    await db.delete(scene)
    await db.flush()
    return "scene.deleted", {"id": scene.id}


HANDLERS = {
    "token.add": token_add,
    "token.move": token_move,
    "token.update": token_update,
    "token.remove": token_remove,
    "wall.add": wall_add,
    "wall.remove": wall_remove,
    "scene.update": scene_update,
}

CAMPAIGN_HANDLERS = {
    "chat.say": chat_say,
    "scene.create": scene_create,
    "scene.activate": scene_activate,
    "scene.delete": scene_delete,
}

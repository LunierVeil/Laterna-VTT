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

import hashlib
import json
import math
import re
import secrets
import time

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import datetime, timezone

from . import auth, dice, fog, sheet_data
from .importers import lss
from .config import MAX_SCENE_SIDE, UPLOAD_DIR
from .geometry import path_blocked
from .models import AuthSession, Campaign, Character, Invite, Message, Scene, SceneFolder, Token, User, Wall
from .roles import Actor


class CommandError(Exception):
    pass


def _as_num(value: object, key: str) -> float:
    """Число из команды. NaN и бесконечность - ошибка команды, а не
    исключение: json.loads принимает Infinity и NaN, а 1e400 даёт inf.
    Такое число в координатах ломает снапшот сцены для всех."""
    if isinstance(value, bool):
        raise CommandError(f"поле {key} должно быть числом")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        raise CommandError(f"поле {key} должно быть числом")
    if not math.isfinite(number):
        raise CommandError(f"поле {key} должно быть конечным числом")
    return number


def _num(payload: dict, key: str, default=None) -> float:
    value = payload.get(key, default)
    if value is None:
        raise CommandError(f"не хватает поля {key}")
    return _as_num(value, key)


def _int(payload: dict, key: str, lo: float, hi: float, default=None) -> int:
    """Целое в пределах: дробное отбрасывается, лишнее зажимается."""
    return int(_clamp(_num(payload, key, default), lo, hi))


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


HIDDEN = "hidden"  # ключ видимости в payload, см. _with_hidden


def _scene_fog(scene: Scene) -> list[dict]:
    return json.loads(scene.fog_json) if scene.fog_json else []


def _mark_token(payload: dict, token: Token, layer: tuple, fog_state: tuple) -> dict:
    """Пометка для токена: слой ГМ и туман до и после. Под туманом токен
    не видят игроки, кроме владельца; полный токен - чтобы показать его,
    если он вышел из тумана."""
    payload[HIDDEN] = {"kind": "token", "layer": layer, "fog": fog_state, "owner": token.owner_id, "full": token.to_dict()}
    return payload


def _mark_wall(payload: dict, wall: Wall, fog_state: tuple) -> dict:
    payload[HIDDEN] = {"kind": "wall", "fog": fog_state, "full": wall.to_dict()}
    return payload


def _wall_fogged(fog_rects: list[dict], wall: Wall) -> bool:
    return fog.covers_segment(fog_rects, wall.x1, wall.y1, wall.x2, wall.y2)


def _require_gm(actor: Actor, message: str = "это может только ГМ") -> None:
    if not actor.is_gm:
        raise CommandError(message)


def _require_owner(obj: Token | Wall, actor: Actor, message: str) -> None:
    # Своё может менять владелец, чужое - только ГМ: он ведёт партию и
    # убирает за всеми. Объект без владельца - общий.
    if actor.is_gm:
        return
    if obj.owner_id is not None and obj.owner_id != actor.id:
        raise CommandError(message)


async def _campaign_user(db: AsyncSession, campaign_id: str, user_id: object) -> str | None:
    """id существующего пользователя этой кампании или None (общий)."""
    if user_id is None:
        return None
    user = await db.get(User, str(user_id))
    if user is None or user.campaign_id != campaign_id:
        raise CommandError("нет такого игрока")
    return user.id


async def _linked_character(db: AsyncSession, campaign_id: str, actor: Actor, char_id: object) -> Character | None:
    """Привязать токен можно к своему персонажу, ГМ - к любому. None - отвязать."""
    if char_id is None:
        return None
    character = await db.get(Character, str(char_id))
    # Чужой лист - "нет такого", как и в командах листа: не выдаём, что он есть.
    if character is None or character.campaign_id != campaign_id or not (
        actor.is_gm or character.owner_id == actor.id
    ):
        raise CommandError("нет такого персонажа")
    return character


# --- мобы -------------------------------------------------------------------
#
# Моб - лист с system="mob": шаблон. Хиты экземпляра живут на токене
# (Token.hp), поэтому пять гоблинов с одного листа ранены по-разному. Другой
# гоблин (с луком) - копия листа (character.copy), а не правка шаблона.

MOB = "mob"
SYSTEMS = {"dnd5e", MOB}
HP_LIMIT = 99_999


def _mob_data(character: Character) -> dict:
    data = json.loads(character.data_json or "{}")
    return data if isinstance(data, dict) else {}


def _mob_max_hp(character: Character) -> int | None:
    hp = _mob_data(character).get("hp")
    value = hp.get("max") if isinstance(hp, dict) else None
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _mob_portrait(character: Character) -> str | None:
    # В листе - просто строка. На токен попадает только загруженная картинка.
    try:
        return _upload_url(_mob_data(character).get("portrait"), "портрет")
    except CommandError:
        return None


async def _mob_instance_name(db: AsyncSession, scene_id: str, character: Character) -> str:
    """Гоблин 1, Гоблин 2... - первый свободный номер на этой сцене."""
    names = set(
        (await db.execute(select(Token.name).where(Token.scene_id == scene_id, Token.character_id == character.id)))
        .scalars()
        .all()
    )
    n = 1
    while f"{character.name} {n}"[:200] in names:
        n += 1
    return f"{character.name} {n}"[:200]


def _hp_value(value: object) -> int | None:
    if value is None:
        return None
    # Конечность - до int(): int(inf) и int(nan) бросают исключение, а не
    # ошибку команды.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CommandError("хиты - целое число")
    if isinstance(value, float) and not (math.isfinite(value) and value.is_integer()):
        raise CommandError("хиты - целое число")
    return int(_clamp(int(value), -HP_LIMIT, HP_LIMIT))


async def token_add(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    # Владельцем другого может поставить только ГМ: иначе игрок создавал
    # бы токены от чужого имени. Остальным - всегда они сами.
    owner_id = actor.id
    if actor.is_gm and "owner_id" in payload:
        owner_id = await _campaign_user(db, scene.campaign_id, payload["owner_id"])
    character = await _linked_character(db, scene.campaign_id, actor, payload.get("character_id"))
    name = str(payload.get("name") or "Токен")[:200]
    image_url = _upload_url(payload.get("image_url"), "картинка токена")
    hp = None
    if character is not None and character.system == MOB:
        # Экземпляр моба: свой номер, полные хиты, портрет из листа.
        name = await _mob_instance_name(db, scene.id, character)
        hp = _mob_max_hp(character)
    elif character is not None:
        owner_id = character.owner_id
        name = str(payload.get("name") or character.name)[:200]
    token = Token(
        scene_id=scene.id,
        name=name,
        x=_clamp(_num(payload, "x", 0), 0, scene.width),
        y=_clamp(_num(payload, "y", 0), 0, scene.height),
        size=_clamp(_as_num(payload.get("size") or 1, "size"), 0.25, 10),
        color=str(payload.get("color") or "#c75c5c")[:20],
        image_url=image_url,
        character_id=character.id if character else None,
        hp=hp,
        # Скрытый от игроков токен ставит только ГМ: иначе игрок прятал бы
        # свои токены от остальных.
        layer="gm" if payload.get("layer") == "gm" and actor.is_gm else "tokens",
        owner_id=owner_id,
    )
    db.add(token)
    await db.flush()
    hidden = token.layer == "gm"
    fogged = fog.contains_point(_scene_fog(scene), token.x, token.y)
    return "token.added", _mark_token({"token": token.to_dict()}, token, (hidden, hidden), (fogged, fogged))


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

    fog_rects = _scene_fog(scene)
    fog_before = fog.contains_point(fog_rects, token.x, token.y)
    token.x, token.y = nx, ny
    await db.flush()
    hidden = token.layer == "gm"
    fog_after = fog.contains_point(fog_rects, token.x, token.y)
    return "token.moved", _mark_token(
        {"id": token.id, "x": token.x, "y": token.y}, token, (hidden, hidden), (fog_before, fog_after)
    )


async def token_update(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    token = await db.get(Token, payload.get("id"))
    if token is None or token.scene_id != scene.id:
        raise CommandError("токен не найден")
    # Без этой проверки чужой игрок переписал бы владельца на себя и удалил токен.
    _require_owner(token, actor, "нельзя менять чужой токен")
    fog_rects = _scene_fog(scene)
    fog_before = fog.contains_point(fog_rects, token.x, token.y)
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
    if "owner_id" in payload:
        # Отдать токен другому - решение мастера. Иначе игрок "подарил" бы
        # свой токен кому-то или сделал его общим (owner_id = null), и его
        # смог бы двигать и удалять любой.
        _require_gm(actor, "менять владельца может только ГМ")
        token.owner_id = await _campaign_user(db, scene.campaign_id, payload["owner_id"])
    if "character_id" in payload:
        character = await _linked_character(db, scene.campaign_id, actor, payload["character_id"])
        if character is None or character.system != MOB:
            token.hp = None  # хиты персонажа - в его листе
        elif token.character_id != character.id:
            token.hp = _mob_max_hp(character)
        token.character_id = character.id if character else None
    if "hp" in payload:
        linked = await db.get(Character, token.character_id) if token.character_id else None
        if linked is None or linked.system != MOB:
            raise CommandError("хиты этого токена - в листе персонажа")
        token.hp = _hp_value(payload["hp"])
    if "size" in payload:
        size = _clamp(_num(payload, "size"), 0.25, 10)
        # Держим на месте левый верхний угол, а не центр: иначе токен 2x2
        # встанет центром в клетку и съедет с сетки на полклетки.
        shift = (size - token.size) * scene.grid_size / 2
        token.x = _clamp(token.x + shift, 0, scene.width)
        token.y = _clamp(token.y + shift, 0, scene.height)
        token.size = size
    was_hidden = token.layer == "gm"
    if "layer" in payload:
        # Показать токен игрокам или спрятать - решение мастера.
        _require_gm(actor, "скрывать и показывать токены может только ГМ")
        token.layer = "gm" if payload["layer"] == "gm" else "tokens"
    await db.flush()
    fog_after = fog.contains_point(fog_rects, token.x, token.y)
    return "token.updated", _mark_token(
        {"token": token.to_dict()}, token, (was_hidden, token.layer == "gm"), (fog_before, fog_after)
    )


async def token_remove(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    token = await db.get(Token, payload.get("id"))
    if token is None or token.scene_id != scene.id:
        raise CommandError("токен не найден")
    _require_owner(token, actor, "нельзя удалить чужой токен")
    hidden = token.layer == "gm"
    fogged = fog.contains_point(_scene_fog(scene), token.x, token.y)
    marked = _mark_token({"id": payload["id"]}, token, (hidden, hidden), (fogged, fogged))
    await db.delete(token)
    await db.flush()
    return "token.removed", marked


# Пока только стена и дверь. Тайная дверь, окно, невидимая стена есть в
# модели (ждут освещения), но тайную дверь нельзя слать игроку как тайную -
# это утечка; её маскировка под стену - отдельный шаг.
WALL_KINDS = {"wall", "door"}
DOOR_STATES = {"closed", "open", "locked"}


def _wall_kind(value: object) -> str:
    kind = str(value or "wall")
    if kind not in WALL_KINDS:
        raise CommandError(f"такой стены пока нет: {kind[:20]}")
    return kind


def _door_state(value: object) -> str:
    state = str(value or "closed")
    if state not in DOOR_STATES:
        raise CommandError("дверь бывает closed, open или locked")
    return state


async def wall_door(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    """Открыть, закрыть, запереть дверь.

    Открыть и закрыть может любой - в игре персонажи открывают двери сами.
    И с любого расстояния: пока нет видимости и освещения, серверу не по чему
    проверить, что персонаж рядом. Появится видимость - тогда и дистанция.
    Запереть и отпереть - только мастер: иначе игрок отпирал бы двери,
    которые мастер запер, просто кликом.
    """
    wall = await db.get(Wall, payload.get("id")) if payload.get("id") else None
    if wall is None or wall.scene_id != scene.id or wall.kind != "door":
        raise CommandError("двери не найдено")
    state = _door_state(payload.get("state"))
    if not actor.is_gm and (wall.door_state == "locked" or state == "locked"):
        raise CommandError("дверь заперта")
    wall.door_state = state
    await db.flush()
    fogged = _wall_fogged(_scene_fog(scene), wall)
    return "wall.updated", _mark_wall({"wall": wall.to_dict()}, wall, (fogged, fogged))


async def wall_add(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    # Стены - разметка карты, её делает мастер. Игрок со стенами мог бы
    # запереть других или отгородиться от монстров.
    _require_gm(actor, "стены ставит только ГМ")
    # В границы сцены, как токены: стена за краем карты никому не нужна,
    # а огромные координаты ломают геометрию движения.
    wall = Wall(
        scene_id=scene.id,
        x1=_clamp(_num(payload, "x1"), 0, scene.width),
        y1=_clamp(_num(payload, "y1"), 0, scene.height),
        x2=_clamp(_num(payload, "x2"), 0, scene.width),
        y2=_clamp(_num(payload, "y2"), 0, scene.height),
        kind=_wall_kind(payload.get("kind")),
        door_state=_door_state(payload.get("door_state")),
        blocks_movement=bool(payload.get("blocks_movement", True)),
        blocks_sight=bool(payload.get("blocks_sight", True)),
        blocks_sound=bool(payload.get("blocks_sound", False)),
        owner_id=actor.id,
    )
    if (wall.x1, wall.y1) == (wall.x2, wall.y2):
        raise CommandError("стена нулевой длины")
    db.add(wall)
    await db.flush()
    fogged = _wall_fogged(_scene_fog(scene), wall)
    return "wall.added", _mark_wall({"wall": wall.to_dict()}, wall, (fogged, fogged))


async def wall_remove(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    wall = await db.get(Wall, payload.get("id"))
    if wall is None or wall.scene_id != scene.id:
        raise CommandError("стена не найдена")
    _require_owner(wall, actor, "нельзя удалить чужую стену")
    fogged = _wall_fogged(_scene_fog(scene), wall)
    marked = _mark_wall({"id": payload["id"]}, wall, (fogged, fogged))
    await db.delete(wall)
    await db.flush()
    return "wall.removed", marked


async def scene_update(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    if not actor.is_gm:
        raise CommandError("сцену меняет только ГМ")
    if "grid_size" in payload:
        scene.grid_size = _int(payload, "grid_size", 10, 400)
    if "name" in payload:
        scene.name = str(payload["name"])[:200]
    if "background_url" in payload:
        scene.background_url = _upload_url(payload["background_url"], "фон")
    if "width" in payload:
        scene.width = _int(payload, "width", 100, MAX_SCENE_SIDE)
    if "height" in payload:
        scene.height = _int(payload, "height", 100, MAX_SCENE_SIDE)
    await db.flush()
    return "scene.updated", {
        "grid_size": scene.grid_size,
        "name": scene.name,
        "background_url": scene.background_url,
        "width": scene.width,
        "height": scene.height,
    }


_GM_ROLL = re.compile(r"^/gr\s+(?P<formula>.+)$", re.IGNORECASE)


def _roll_message(
    campaign: Campaign, actor: Actor, formula: str, label: str | None = None, hidden: bool = False
) -> Message:
    """Бросок - только здесь, через dice (secrets). Клиент шлёт формулу.

    hidden - скрытый бросок мастера: результат видит только ГМ (и сам
    бросивший), игроку main.py отдаёт заглушку без цифр.
    """
    if hidden and not actor.is_gm:
        raise CommandError("скрытый бросок - только для ГМ")
    try:
        result = dice.roll(formula)
    except dice.DiceError as exc:
        raise CommandError(str(exc))
    roll = result.to_dict()
    if label:
        # Подпись - внутри результата: схема сообщений не меняется.
        roll["label"] = label
    if hidden:
        roll["hidden"] = True
    return Message(
        campaign_id=campaign.id,
        author=actor.name,
        author_id=actor.id,
        text=formula,
        kind="roll",
        roll_json=json.dumps(roll, ensure_ascii=False),
    )


async def chat_say(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    text = str(payload.get("text") or "").strip()
    if not text:
        raise CommandError("пустое сообщение")
    if len(text) > 2000:
        raise CommandError("слишком длинное сообщение")

    gm_roll = _GM_ROLL.match(text)
    formula = dice.parse_chat(text)
    if gm_roll:
        message = _roll_message(campaign, actor, gm_roll.group("formula"), hidden=True)
    elif formula:
        message = _roll_message(campaign, actor, formula)
    else:
        message = Message(
            campaign_id=campaign.id, author=actor.name, author_id=actor.id, text=text, kind="text"
        )

    db.add(message)
    await db.flush()
    return "chat.said", {"message": message.to_dict()}


async def _campaign_scene(db: AsyncSession, campaign: Campaign, payload: dict) -> Scene:
    scene = await db.get(Scene, payload.get("id")) if payload.get("id") else None
    if scene is None or scene.campaign_id != campaign.id:
        raise CommandError("сцена не найдена")
    return scene


async def dice_roll(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    """Бросок с подписью - из листа: "Цеп - атака". Тот же бросок, что /r.

    Клиент присылает только формулу и подпись; число выпадает здесь.
    """
    formula = str(payload.get("formula") or "").strip()
    if not formula:
        raise CommandError("пустая формула")
    label = str(payload.get("label") or "").strip()[:120] or None
    message = _roll_message(campaign, actor, formula, label, hidden=bool(payload.get("hidden")))
    db.add(message)
    await db.flush()
    return "chat.said", {"message": message.to_dict()}


async def _scene_folder(db: AsyncSession, campaign: Campaign, folder_id: str) -> SceneFolder:
    folder = await db.get(SceneFolder, folder_id) if isinstance(folder_id, str) else None
    if folder is None or folder.campaign_id != campaign.id:
        raise CommandError("папка не найдена")
    return folder


def _folder_name(payload: dict) -> str:
    name = str(payload.get("name") or "").strip()[:200]
    if not name:
        raise CommandError("нужно название папки")
    return name


async def folder_create(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    _require_gm(actor)
    folder = SceneFolder(campaign_id=campaign.id, name=_folder_name(payload))
    db.add(folder)
    await db.flush()
    return "folder.created", {"id": folder.id}


async def folder_rename(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    _require_gm(actor)
    folder = await _scene_folder(db, campaign, payload.get("id"))
    folder.name = _folder_name(payload)
    await db.flush()
    return "folder.renamed", {"id": folder.id}


async def folder_delete(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    _require_gm(actor)
    folder = await _scene_folder(db, campaign, payload.get("id"))
    # Explicitly unassign even on SQLite connections without foreign_keys enabled.
    await db.execute(update(Scene).where(Scene.campaign_id == campaign.id, Scene.folder_id == folder.id).values(folder_id=None))
    await db.delete(folder)
    await db.flush()
    return "folder.deleted", {"id": folder.id}


async def scene_move(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    _require_gm(actor)
    scene = await _campaign_scene(db, campaign, payload)
    folder_id = payload.get("folder_id")
    if folder_id is not None:
        await _scene_folder(db, campaign, folder_id)
    siblings = list((await db.execute(select(Scene).where(
        Scene.campaign_id == campaign.id, Scene.folder_id == folder_id, Scene.id != scene.id
    ).order_by(Scene.sort_order.asc().nulls_last(), Scene.created_at, Scene.id))).scalars())
    before_id = payload.get("before_id")
    position = len(siblings)
    if before_id is not None:
        position = next((i for i, s in enumerate(siblings) if s.id == before_id), -1)
        if position < 0:
            raise CommandError("сцена назначения не найдена в папке")
    siblings.insert(position, scene)
    scene.folder_id = folder_id
    for i, item in enumerate(siblings):
        item.sort_order = i
    await db.flush()
    return "scene.moved", {"id": scene.id}


async def scene_create(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    _require_gm(actor)
    name = str(payload.get("name") or "").strip()[:200] or "Новая сцена"
    folder_id = payload.get("folder_id")
    if folder_id is not None:
        await _scene_folder(db, campaign, folder_id)
    scene = Scene(campaign_id=campaign.id, name=name, folder_id=folder_id)
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


async def _campaign_player(db: AsyncSession, campaign: Campaign, payload: dict, gm_message: str) -> User:
    user = await db.get(User, payload.get("id")) if payload.get("id") else None
    if user is None or user.campaign_id != campaign.id:
        raise CommandError("нет такого игрока")
    if user.is_gm:
        raise CommandError(gm_message)
    return user


async def invite_create(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    """Ссылка-приглашение. Без user_id - новый игрок, с ним - сброс пароля.

    Регистрации нет: аккаунт появляется только по ссылке от мастера. Но
    имя и пароль игрок придумывает сам - мастеру их знать незачем.
    Код из ссылки уходит только мастеру в reply, в базе - его хеш.
    """
    _require_gm(actor)
    user_id = None
    if payload.get("user_id"):
        user = await _campaign_player(
            db, campaign, {"id": payload["user_id"]}, "пароль мастера сбрасывается ключом ГМ"
        )
        user_id = user.id
    token = await auth.create_invite(db, campaign, user_id)
    return "invite.created", {"token": token, "user_id": user_id}


async def invite_revoke(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    _require_gm(actor)
    invite = await db.get(Invite, str(payload.get("id") or ""))
    if invite is None or invite.campaign_id != campaign.id:
        raise CommandError("нет такого приглашения")
    await db.delete(invite)
    await db.flush()
    return "invite.revoked", {"id": payload["id"]}


async def player_delete(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    _require_gm(actor)
    user = await _campaign_player(db, campaign, payload, "аккаунт мастера удалить нельзя")
    # Токены и стены ушедшего игрока переходят мастеру, а не становятся
    # общими: общий токен может двигать и удалять кто угодно.
    for model in (Token, Wall, Character):
        await db.execute(update(model).where(model.owner_id == user.id).values(owner_id=actor.id))
    await db.execute(AuthSession.__table__.delete().where(AuthSession.user_id == user.id))
    await db.execute(Invite.__table__.delete().where(Invite.user_id == user.id))
    await db.delete(user)
    await db.flush()
    return "player.deleted", {"id": user.id}


async def _own_character(db: AsyncSession, campaign: Campaign, actor: Actor, char_id: object) -> Character:
    character = await db.get(Character, str(char_id)) if char_id else None
    # Чужой лист для игрока - "нет такого", а не "нельзя": иначе по ответу
    # было бы видно, что он существует.
    if (
        character is None
        or character.campaign_id != campaign.id
        or not (actor.is_gm or character.owner_id == actor.id)
    ):
        raise CommandError("нет такого персонажа")
    return character


def _character_name(value: object) -> str:
    return str(value or "").strip()[:200] or "Персонаж"


async def character_create(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    # Свой лист заводит любой. Чужим (NPC для игрока) владельца ставит ГМ.
    owner_id = actor.id
    if actor.is_gm and "owner_id" in payload:
        owner_id = await _campaign_user(db, campaign.id, payload["owner_id"])
    system = str(payload.get("system") or "dnd5e")
    if system not in SYSTEMS:
        raise CommandError("нет такой системы листа")
    if system == MOB:
        _require_gm(actor, "мобов заводит ГМ")
    character = Character(
        campaign_id=campaign.id,
        owner_id=owner_id,
        name=_character_name(payload.get("name")),
        system=system,
        data_json="{}",
    )
    db.add(character)
    await db.flush()
    return "character.created", {"character": character.to_dict()}


async def character_update(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    """Правка по полям: {id, name?, set?: {"путь.к.полю": значение}}.

    По полям, а не листом целиком: ГМ и игрок, правящие разные поля
    одновременно, не затирают друг друга. Правил сервер не проверяет -
    только форму данных (sheet_data).
    """
    character = await _own_character(db, campaign, actor, payload.get("id"))
    if "name" in payload:
        character.name = _character_name(payload["name"])
    if "set" in payload:
        try:
            data = sheet_data.apply_set(json.loads(character.data_json or "{}"), payload["set"])
            character.data_json = sheet_data.dump(data)
        except sheet_data.SheetError as exc:
            raise CommandError(str(exc))
    character.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return "character.saved", {"character": character.to_dict()}


async def character_list(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    """Элемент списка листа: {id, path, op: add|update|remove, item?, item_id?, changes?}.

    Заклинания, карточки - по одному элементу, а не списком целиком: два
    одновременных добавления не затирают друг друга. Что за элементы, сервер
    не знает - проверяет только форму (sheet_data)."""
    character = await _own_character(db, campaign, actor, payload.get("id"))
    try:
        data = sheet_data.apply_list(
            json.loads(character.data_json or "{}"),
            payload.get("path"),
            payload.get("op"),
            item=payload.get("item"),
            item_id=payload.get("item_id"),
            changes=payload.get("changes"),
        )
        character.data_json = sheet_data.dump(data)
    except sheet_data.SheetError as exc:
        raise CommandError(str(exc))
    character.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return "character.saved", {"character": character.to_dict()}


async def character_counter(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    """Счётчик листа на дельту: {id, path, delta, max_path?}. Потратить ячейку
    заклинаний - delta -1 по "slots.N.left" с max_path "slots.N.total":
    сколько осталось, считает сервер, а не клиент."""
    character = await _own_character(db, campaign, actor, payload.get("id"))
    try:
        data = sheet_data.apply_counter(
            json.loads(character.data_json or "{}"),
            payload.get("path"),
            payload.get("delta"),
            payload.get("max_path"),
        )
        character.data_json = sheet_data.dump(data)
    except sheet_data.SheetError as exc:
        raise CommandError(str(exc))
    character.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return "character.saved", {"character": character.to_dict()}


async def character_copy(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    """Копия листа - «гоблин, но с луком». Владелец тот же; исходник
    импорта не копируем: копию правят руками."""
    source = await _own_character(db, campaign, actor, payload.get("id"))
    # Имя - первый свободный номер: копия "Гоблина" - "Гоблин 2", копия
    # "Гоблина 2" - "Гоблин 3", а не "Гоблин 2 2".
    base = re.sub(r"\s+\d+$", "", source.name) or source.name
    names = set(
        (await db.execute(select(Character.name).where(Character.campaign_id == campaign.id))).scalars().all()
    )
    n = 2
    while _character_name(f"{base} {n}") in names:
        n += 1
    character = Character(
        campaign_id=campaign.id,
        owner_id=source.owner_id,
        name=_character_name(f"{base} {n}"),
        system=source.system,
        data_json=source.data_json,
    )
    db.add(character)
    await db.flush()
    return "character.created", {"character": character.to_dict()}


def _parse_lss(raw: object) -> tuple[str, dict, dict]:
    try:
        name, data, report = lss.parse_report(raw)
        sheet_data.check_value(data)
    except (lss.LssError, sheet_data.SheetError) as exc:
        raise CommandError(f"импорт LSS: {exc}")
    return name, data, report


async def character_import(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    """Новый лист из файла Long Story Short. Файл хранится целиком."""
    raw = payload.get("source")
    name, data, report = _parse_lss(raw)
    owner_id = actor.id
    if actor.is_gm and "owner_id" in payload:
        owner_id = await _campaign_user(db, campaign.id, payload["owner_id"])
    character = Character(
        campaign_id=campaign.id,
        owner_id=owner_id,
        name=_character_name(name),
        system="dnd5e",
        data_json=sheet_data.dump(data),
        source_format=lss.FORMAT,
        source_json=raw,
    )
    db.add(character)
    await db.flush()
    # Отчёт - в ответе тому, кто импортировал (reply), а не в рассылке листа.
    return "character.created", {"character": character.to_dict(), "report": report}


async def character_reimport(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    """Заново прогнать сохранённый исходник через текущий адаптер.

    Нужно, когда адаптер поменялся. Значения из файла заменяются, вписанное
    игроком сверх файла остаётся (lss.merge_reimport). Имя не трогаем: его
    могли сменить уже после импорта.
    """
    character = await _own_character(db, campaign, actor, payload.get("id"))
    if character.source_format != lss.FORMAT or not character.source_json:
        raise CommandError("этот лист не импортирован из LSS")
    _, data, _ = _parse_lss(character.source_json)
    # Слияние - в адаптере: что считать своим, знает формат, а не ядро.
    character.data_json = sheet_data.dump(lss.merge_reimport(json.loads(character.data_json or "{}"), data))
    character.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return "character.saved", {"character": character.to_dict()}


async def character_delete(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    character = await _own_character(db, campaign, actor, payload.get("id"))
    owner_id = character.owner_id
    # Токены остаются, просто без листа. FK в SQLite не включены - явно.
    await db.execute(update(Token).where(Token.character_id == character.id).values(character_id=None, hp=None))
    await db.delete(character)
    await db.flush()
    return "character.deleted", {"id": character.id, "owner_id": owner_id}


# --- бой: трекер инициативы -------------------------------------------------
#
# Чей ход - id участника, а не номер в списке: добавили участника или
# поменяли инициативу посреди раунда - ход не перескакивает на другого.

def _combat(scene: Scene) -> dict:
    if scene.combat_json:
        return json.loads(scene.combat_json)
    return {"round": 0, "current": None, "entries": []}


async def _refresh_entries(db: AsyncSession, combat: dict) -> None:
    """Имя, владелец и лист - с токена, как сейчас. Панели нужны владелец
    (кому показывать кнопки) и лист (бонус инициативы), а токены в React не
    живут. Это id, не данные листа - утечки нет."""
    for e in combat["entries"]:
        token = await db.get(Token, e["token_id"]) if e.get("token_id") else None
        if token is not None:
            e["name"], e["owner_id"], e["character_id"] = token.name, token.owner_id, token.character_id
            # Скрытый токен в бою - засада: игрокам эту строку не показываем.
            e["hidden"] = token.layer == "gm"


def _save_combat(scene: Scene, combat: dict | None) -> tuple[str, dict]:
    if combat is not None:
        # Порядок - по убыванию инициативы; у кого её нет - в конце, в
        # порядке добавления (sort стабильный).
        combat["entries"].sort(key=lambda e: -(e["init"]) if e.get("init") is not None else float("inf"))
    scene.combat_json = json.dumps(combat, ensure_ascii=False) if combat else None
    return "combat.updated", {"combat": combat}


def _entry(combat: dict, entry_id: object) -> dict:
    for e in combat["entries"]:
        if e["id"] == entry_id:
            return e
    raise CommandError("нет такого участника боя")


async def _entry_token_owner(db: AsyncSession, entry: dict) -> str | None:
    token = await db.get(Token, entry["token_id"]) if entry.get("token_id") else None
    return token.owner_id if token else None


async def _require_entry_rights(db: AsyncSession, actor: Actor, entry: dict) -> None:
    # Свою строку правит владелец токена, любую - ГМ.
    if actor.is_gm:
        return
    if await _entry_token_owner(db, entry) != actor.id:
        raise CommandError("это не твой участник боя")


async def combat_add(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    token = await db.get(Token, payload.get("token_id")) if payload.get("token_id") else None
    if token is None or token.scene_id != scene.id:
        raise CommandError("токен не найден")
    _require_owner(token, actor, "в бой можно добавить только свой токен")
    combat = _combat(scene)
    if any(e["token_id"] == token.id for e in combat["entries"]):
        raise CommandError("этот токен уже в бою")
    if len(combat["entries"]) >= 50:
        raise CommandError("слишком много участников")
    combat["entries"].append(
        {"id": f"e-{secrets.token_hex(6)}", "token_id": token.id, "name": token.name, "init": None}
    )
    await _refresh_entries(db, combat)
    return _save_combat(scene, combat)


async def combat_set(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    combat = _combat(scene)
    entry = _entry(combat, payload.get("entry_id"))
    await _require_entry_rights(db, actor, entry)
    value = payload.get("init")
    entry["init"] = None if value is None else _int(payload, "init", -50, 100)
    entry.pop("roll", None)
    await _refresh_entries(db, combat)
    return _save_combat(scene, combat)


async def combat_roll(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    """Бросок инициативы: 1d20 + бонус. Бросает сервер, клиент шлёт бонус."""
    combat = _combat(scene)
    entry = _entry(combat, payload.get("entry_id"))
    await _require_entry_rights(db, actor, entry)
    bonus = _int(payload, "bonus", -20, 30, default=0)
    formula = f"1d20{bonus:+d}" if bonus else "1d20"
    result = dice.roll(formula)
    entry["init"] = result.total
    # Что выпало - чтобы было видно, что бросок честный, а не вписанный.
    entry["roll"] = {"formula": formula, "die": result.terms[0].rolls[0]}
    await _refresh_entries(db, combat)
    return _save_combat(scene, combat)


async def combat_remove(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    combat = _combat(scene)
    entry = _entry(combat, payload.get("entry_id"))
    await _require_entry_rights(db, actor, entry)
    if combat["current"] == entry["id"]:
        # Убрали того, чей ход, - ход у следующего.
        ids = [e["id"] for e in combat["entries"]]
        i = ids.index(entry["id"])
        rest = ids[:i] + ids[i + 1:]
        combat["current"] = rest[i % len(rest)] if rest else None
    combat["entries"] = [e for e in combat["entries"] if e["id"] != entry["id"]]
    await _refresh_entries(db, combat)
    return _save_combat(scene, combat if combat["entries"] else None)


async def combat_next(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    """Следующий ход. ГМ - всегда; игрок - только закончить свой ход."""
    combat = _combat(scene)
    if not combat["entries"]:
        raise CommandError("в бою никого нет")
    if not actor.is_gm:
        if combat["current"] is None:
            raise CommandError("бой начинает ГМ")
        await _require_entry_rights(db, actor, _entry(combat, combat["current"]))
    _save_combat(scene, combat)  # отсортировать перед поиском следующего
    ids = [e["id"] for e in combat["entries"]]
    if combat["current"] not in ids:
        combat["current"], combat["round"] = ids[0], max(1, combat["round"])
    else:
        i = ids.index(combat["current"]) + 1
        if i >= len(ids):
            i, combat["round"] = 0, combat["round"] + 1
        combat["current"] = ids[i]
    await _refresh_entries(db, combat)
    return _save_combat(scene, combat)


async def combat_end(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    _require_gm(actor, "закончить бой может только ГМ")
    return _save_combat(scene, None)


# --- ручной туман ---------------------------------------------------------
#
# Прямоугольники в пикселях сцены (fog.py). Меняет только ГМ. Под туманом
# игрокам не уходят токены (кроме своих) и стены - так же, как токены слоя
# ГМ. Событие одно - fog.updated с новым туманом; main для каждого игрока
# дописывает, что у него появилось и что исчезло.
#
# Отмена (fog.undo) - только своего последнего действия: история в памяти
# процесса, до 50 шагов на сцену. Если последним менял туман другой мастер -
# отказ, иначе отмена стёрла бы и его правку.

_fog_history: dict[str, list[tuple[str, list[dict]]]] = {}


def _fog_rect(scene: Scene, payload: dict) -> dict:
    x = _clamp(_num(payload, "x"), 0, scene.width)
    y = _clamp(_num(payload, "y"), 0, scene.height)
    x2 = _clamp(x + _num(payload, "w"), 0, scene.width)
    y2 = _clamp(y + _num(payload, "h"), 0, scene.height)
    if x2 - x <= 0 or y2 - y <= 0:
        raise CommandError("прямоугольник тумана пустой")
    return fog.make(x, y, x2 - x, y2 - y)


async def _fog_set(db: AsyncSession, scene: Scene, actor: Actor, after: list[dict], undo: bool = False):
    """Записать новый туман и собрать, что из-за него поменялось для игроков."""
    if len(after) > fog.MAX_RECTS:
        raise CommandError(f"тумана слишком много кусков (больше {fog.MAX_RECTS}) - закрой область целиком")
    before = _scene_fog(scene)
    if not undo:
        history = _fog_history.setdefault(scene.id, [])
        history.append((actor.id, before))
        del history[:-50]
    scene.fog_json = json.dumps(after) if after else None
    changes = []
    tokens = (await db.execute(select(Token).where(Token.scene_id == scene.id))).scalars().all()
    for t in tokens:
        b, a = fog.contains_point(before, t.x, t.y), fog.contains_point(after, t.x, t.y)
        if b != a:
            changes.append({"kind": "token", "id": t.id, "layer": (t.layer == "gm", t.layer == "gm"), "fog": (b, a), "owner": t.owner_id, "full": t.to_dict()})
    walls = (await db.execute(select(Wall).where(Wall.scene_id == scene.id))).scalars().all()
    for w in walls:
        b, a = _wall_fogged(before, w), _wall_fogged(after, w)
        if b != a:
            changes.append({"kind": "wall", "id": w.id, "fog": (b, a), "full": w.to_dict()})
    await db.flush()
    return "fog.updated", {"fog": after, HIDDEN: {"kind": "fog", "changes": changes}}


async def fog_cover(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    _require_gm(actor, "туман меняет только ГМ")
    return await _fog_set(db, scene, actor, [*_scene_fog(scene), _fog_rect(scene, payload)])


async def fog_reveal(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    _require_gm(actor, "туман меняет только ГМ")
    return await _fog_set(db, scene, actor, fog.reveal(_scene_fog(scene), _fog_rect(scene, payload)))


async def fog_cover_all(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    _require_gm(actor, "туман меняет только ГМ")
    return await _fog_set(db, scene, actor, [fog.make(0, 0, scene.width, scene.height)])


async def fog_clear(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    _require_gm(actor, "туман меняет только ГМ")
    return await _fog_set(db, scene, actor, [])


async def fog_undo(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    _require_gm(actor, "туман меняет только ГМ")
    history = _fog_history.get(scene.id) or []
    if not history:
        raise CommandError("отменять в тумане нечего")
    owner, before = history[-1]
    if owner != actor.id:
        raise CommandError("последним туман менял другой мастер - отменить своё нельзя")
    history.pop()
    return await _fog_set(db, scene, actor, before, undo=True)


# --- пинг: не состояние сцены ---------------------------------------------
#
# Кольцо на карте, чтобы показать место. Ничего не меняет: без seq, без
# базы, при переподключении не повторяется. Поэтому не в HANDLERS (те
# увеличивают seq), а отдельно - main рассылает результат всем в сцене.

PING_INTERVAL = 0.7  # не чаще раза в 700 мс на пользователя, лишнее - молча мимо
PING_COLORS = ["#f0b14a", "#6fa8dc", "#7fb37a", "#c75c5c", "#b38fd6", "#4fa3a5", "#d98e48", "#c46fb0"]
_last_ping: dict[str, float] = {}


def ping(scene: Scene, actor: Actor, payload: dict, now: float | None = None) -> dict | None:
    """{x, y} -> сообщение для всех в сцене или None (слишком часто)."""
    x = _clamp(_num(payload, "x"), 0, scene.width)
    y = _clamp(_num(payload, "y"), 0, scene.height)
    now = time.monotonic() if now is None else now
    if now - _last_ping.get(actor.id, float("-inf")) < PING_INTERVAL:
        return None
    _last_ping[actor.id] = now
    # Цвет - от id пользователя: у каждого свой и не меняется между пингами.
    color = PING_COLORS[int(hashlib.sha1(actor.id.encode()).hexdigest(), 16) % len(PING_COLORS)]
    return {"type": "ping", "x": x, "y": y, "author": actor.name, "color": color}


EPHEMERAL = {"ping": ping}


HANDLERS = {
    "token.add": token_add,
    "token.move": token_move,
    "token.update": token_update,
    "token.remove": token_remove,
    "wall.add": wall_add,
    "wall.remove": wall_remove,
    "wall.door": wall_door,
    "fog.cover": fog_cover,
    "fog.reveal": fog_reveal,
    "fog.cover_all": fog_cover_all,
    "fog.clear": fog_clear,
    "fog.undo": fog_undo,
    "scene.update": scene_update,
    "combat.add": combat_add,
    "combat.set": combat_set,
    "combat.roll": combat_roll,
    "combat.remove": combat_remove,
    "combat.next": combat_next,
    "combat.end": combat_end,
}

CAMPAIGN_HANDLERS = {
    "chat.say": chat_say,
    "dice.roll": dice_roll,
    "folder.create": folder_create,
    "folder.rename": folder_rename,
    "folder.delete": folder_delete,
    "scene.move": scene_move,
    "scene.create": scene_create,
    "scene.activate": scene_activate,
    "scene.delete": scene_delete,
    "invite.create": invite_create,
    "invite.revoke": invite_revoke,
    "player.delete": player_delete,
    "character.create": character_create,
    "character.update": character_update,
    "character.list": character_list,
    "character.counter": character_counter,
    "character.copy": character_copy,
    "character.delete": character_delete,
    "character.import": character_import,
    "character.reimport": character_reimport,
}

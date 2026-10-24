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
import secrets

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from datetime import datetime, timezone

from . import auth, dice, sheet_data
from .importers import lss
from .config import MAX_SCENE_SIDE, UPLOAD_DIR
from .geometry import path_blocked
from .models import AuthSession, Campaign, Character, Invite, Message, Scene, Token, User, Wall
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


HIDDEN = "hidden"  # ключ видимости в payload, см. _with_hidden


def _with_hidden(payload: dict, before: bool, after: bool) -> dict:
    """Пометить событие токена: был ли он скрыт от игроков до и после.

    main.py снимает пометку и решает, что отправить игроку: событие как есть,
    пустое (скрыт и был скрыт), token.added (показали) или token.removed
    (спрятали). Хендлер знает слой токена, main.py - кто получатель.
    """
    payload[HIDDEN] = (before, after)
    return payload


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


async def _visible_character(db: AsyncSession, campaign_id: str, actor: Actor, char_id: object) -> str | None:
    """Привязать токен можно к своему персонажу, ГМ - к любому. None - отвязать."""
    if char_id is None:
        return None
    character = await db.get(Character, str(char_id))
    # Чужой лист - "нет такого", как и в командах листа: не выдаём, что он есть.
    if character is None or character.campaign_id != campaign_id or not (
        actor.is_gm or character.owner_id == actor.id
    ):
        raise CommandError("нет такого персонажа")
    return character.id


async def token_add(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    # Владельцем другого может поставить только ГМ: иначе игрок создавал
    # бы токены от чужого имени. Остальным - всегда они сами.
    owner_id = actor.id
    if actor.is_gm and "owner_id" in payload:
        owner_id = await _campaign_user(db, scene.campaign_id, payload["owner_id"])
    token = Token(
        scene_id=scene.id,
        name=str(payload.get("name") or "Токен")[:200],
        x=_clamp(_num(payload, "x", 0), 0, scene.width),
        y=_clamp(_num(payload, "y", 0), 0, scene.height),
        size=_clamp(float(payload.get("size") or 1), 0.25, 10),
        color=str(payload.get("color") or "#c75c5c")[:20],
        image_url=_upload_url(payload.get("image_url"), "картинка токена"),
        # Скрытый от игроков токен ставит только ГМ: иначе игрок прятал бы
        # свои токены от остальных.
        layer="gm" if payload.get("layer") == "gm" and actor.is_gm else "tokens",
        owner_id=owner_id,
    )
    db.add(token)
    await db.flush()
    hidden = token.layer == "gm"
    return "token.added", _with_hidden({"token": token.to_dict()}, hidden, hidden)


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
    hidden = token.layer == "gm"
    return "token.moved", _with_hidden({"id": token.id, "x": token.x, "y": token.y}, hidden, hidden)


async def token_update(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    token = await db.get(Token, payload.get("id"))
    if token is None or token.scene_id != scene.id:
        raise CommandError("токен не найден")
    # Без этой проверки чужой игрок переписал бы владельца на себя и удалил токен.
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
    if "owner_id" in payload:
        # Отдать токен другому - решение мастера. Иначе игрок "подарил" бы
        # свой токен кому-то или сделал его общим (owner_id = null), и его
        # смог бы двигать и удалять любой.
        _require_gm(actor, "менять владельца может только ГМ")
        token.owner_id = await _campaign_user(db, scene.campaign_id, payload["owner_id"])
    if "character_id" in payload:
        token.character_id = await _visible_character(db, scene.campaign_id, actor, payload["character_id"])
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
    return "token.updated", _with_hidden({"token": token.to_dict()}, was_hidden, token.layer == "gm")


async def token_remove(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    token = await db.get(Token, payload.get("id"))
    if token is None or token.scene_id != scene.id:
        raise CommandError("токен не найден")
    _require_owner(token, actor, "нельзя удалить чужой токен")
    hidden = token.layer == "gm"
    await db.delete(token)
    await db.flush()
    return "token.removed", _with_hidden({"id": payload["id"]}, hidden, hidden)


async def wall_add(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    # Стены - разметка карты, её делает мастер. Игрок со стенами мог бы
    # запереть других или отгородиться от монстров.
    _require_gm(actor, "стены ставит только ГМ")
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
        owner_id=actor.id,
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


def _roll_message(campaign: Campaign, actor: Actor, formula: str, label: str | None = None) -> Message:
    """Бросок - только здесь, через dice (secrets). Клиент шлёт формулу."""
    try:
        result = dice.roll(formula)
    except dice.DiceError as exc:
        raise CommandError(str(exc))
    roll = result.to_dict()
    if label:
        # Подпись - внутри результата: схема сообщений не меняется.
        roll["label"] = label
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

    formula = dice.parse_chat(text)
    if formula:
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
    message = _roll_message(campaign, actor, formula, label)
    db.add(message)
    await db.flush()
    return "chat.said", {"message": message.to_dict()}


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
    character = Character(
        campaign_id=campaign.id,
        owner_id=owner_id,
        name=_character_name(payload.get("name")),
        system="dnd5e",
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


def _parse_lss(raw: object) -> tuple[str, dict]:
    try:
        name, data = lss.parse(raw)
        sheet_data.check_value(data)
    except (lss.LssError, sheet_data.SheetError) as exc:
        raise CommandError(f"импорт LSS: {exc}")
    return name, data


async def character_import(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    """Новый лист из файла Long Story Short. Файл хранится целиком."""
    raw = payload.get("source")
    name, data = _parse_lss(raw)
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
    return "character.created", {"character": character.to_dict()}


async def character_reimport(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    """Заново прогнать сохранённый исходник через текущий адаптер.

    Нужно, когда адаптер поменялся. Данные листа заменяются целиком - ручные
    правки пропадут, клиент об этом предупреждает. Имя не трогаем: его могли
    сменить уже после импорта.
    """
    character = await _own_character(db, campaign, actor, payload.get("id"))
    if character.source_format != lss.FORMAT or not character.source_json:
        raise CommandError("этот лист не импортирован из LSS")
    _, data = _parse_lss(character.source_json)
    character.data_json = sheet_data.dump(data)
    character.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return "character.saved", {"character": character.to_dict()}


async def character_delete(db: AsyncSession, campaign: Campaign, actor: Actor, payload: dict):
    character = await _own_character(db, campaign, actor, payload.get("id"))
    owner_id = character.owner_id
    # Токены остаются, просто без листа. FK в SQLite не включены - явно.
    await db.execute(update(Token).where(Token.character_id == character.id).values(character_id=None))
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
    entry["init"] = None if value is None else int(_clamp(_num(payload, "init"), -50, 100))
    entry.pop("roll", None)
    await _refresh_entries(db, combat)
    return _save_combat(scene, combat)


async def combat_roll(db: AsyncSession, scene: Scene, actor: Actor, payload: dict):
    """Бросок инициативы: 1d20 + бонус. Бросает сервер, клиент шлёт бонус."""
    combat = _combat(scene)
    entry = _entry(combat, payload.get("entry_id"))
    await _require_entry_rights(db, actor, entry)
    bonus = int(_clamp(_num(payload, "bonus", 0), -20, 30))
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


HANDLERS = {
    "token.add": token_add,
    "token.move": token_move,
    "token.update": token_update,
    "token.remove": token_remove,
    "wall.add": wall_add,
    "wall.remove": wall_remove,
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
    "scene.create": scene_create,
    "scene.activate": scene_activate,
    "scene.delete": scene_delete,
    "invite.create": invite_create,
    "invite.revoke": invite_revoke,
    "player.delete": player_delete,
    "character.create": character_create,
    "character.update": character_update,
    "character.delete": character_delete,
    "character.import": character_import,
    "character.reimport": character_reimport,
}

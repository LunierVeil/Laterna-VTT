from __future__ import annotations

import ipaddress
import json
import logging
from urllib.parse import urlsplit
from contextlib import asynccontextmanager

import uuid

from fastapi import Depends, FastAPI, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketDisconnected
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from . import auth, fog, protocol
from .config import (
    FRONTEND_URL,
    FRONTEND_URLS,
    LOGIN_MAX_FAILURES,
    LOGIN_MAX_FAILURES_PER_IP,
    LOGIN_MAX_FAILURES_PER_NAME,
    LOGIN_NAME_WINDOW,
    LOGIN_WINDOW,
    MAX_PLAYER_UPLOAD_BYTES,
    MAX_UPLOAD_BYTES,
    PUBLIC_URL,
    TRUST_PROXY,
    UPLOAD_DIR,
    WEB_DIST,
)
from .ratelimit import LoginLimiter
from .db import SessionLocal, get_session, init_db
from .handlers import CAMPAIGN_HANDLERS, EPHEMERAL, HANDLERS, HIDDEN, CommandError
from .hub import hub
from .models import Campaign, Character, Invite, Message, Scene, User
from .roles import Actor, gm_key_notice, is_gm_key


log = logging.getLogger("laterna")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await ensure_demo_scene()
    print(f"\n  {gm_key_notice(FRONTEND_URL)}\n", flush=True)
    yield


app = FastAPI(title="Laterna VTT", lifespan=lifespan)

# Сжатие: через туннель скорость бывает 15-30 КБ/с, а скрипт приложения -
# полмегабайта. Сжатый он втрое меньше. На websocket не действует.
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # dev-режим. Перед публичным хостингом сузить.
    allow_methods=["*"],
    allow_headers=["*"],
)


async def ensure_demo_scene() -> None:
    """Одна сцена из коробки, чтобы было куда зайти сразу после запуска."""
    async with SessionLocal() as db:
        existing = (await db.execute(select(Scene).limit(1))).scalar_one_or_none()
        if existing:
            return
        campaign = Campaign(name="Песочница")
        db.add(campaign)
        await db.flush()
        scene = Scene(campaign_id=campaign.id, name="Первая сцена")
        db.add(scene)
        await db.flush()
        campaign.active_scene_id = scene.id
        await db.commit()


async def get_campaign(db: AsyncSession) -> Campaign:
    # Кампания пока одна. Когда их станет несколько, она будет приходить
    # из адреса, а хаб разделится по кампаниям.
    return (await db.execute(select(Campaign).limit(1))).scalar_one()


def can_see(actor: Actor, campaign: Campaign, scene_id: str) -> bool:
    """Игрок видит только активную сцену, ГМ - любую."""
    return actor.is_gm or scene_id == campaign.active_scene_id


async def session_actor(db: AsyncSession, cookies) -> Actor | None:
    """Кто это - только по сессии. Ничему, что клиент пишет о себе, не верим."""
    token = cookies.get(auth.SESSION_COOKIE)
    user = await auth.session_user(db, token)
    return auth.actor_of(user, token) if user else None


async def require_actor(request: Request, db: AsyncSession) -> Actor:
    actor = await session_actor(db, request.cookies)
    if actor is None:
        raise HTTPException(401, "нужно войти")
    return actor


async def campaign_users(db: AsyncSession, campaign: Campaign) -> list[dict]:
    users = await db.execute(
        select(User).where(User.campaign_id == campaign.id).order_by(User.created_at)
    )
    return [u.to_dict() for u in users.scalars()]


async def campaign_view(db: AsyncSession, campaign: Campaign, actor: Actor) -> dict:
    # Список игроков видят все: имена и так видны в чате и присутствии, а
    # клиенту он нужен, чтобы показать, чей это токен.
    users = await campaign_users(db, campaign)
    if not actor.is_gm:
        return protocol.campaign(campaign.active_scene_id, None, users)
    scenes = (
        await db.execute(
            select(Scene).where(Scene.campaign_id == campaign.id).order_by(Scene.created_at)
        )
    ).scalars()
    invites = await db.execute(
        select(Invite).where(Invite.campaign_id == campaign.id).order_by(Invite.created_at)
    )
    msg = protocol.campaign(
        campaign.active_scene_id, [{"id": s.id, "name": s.name} for s in scenes], users
    )
    # Ожидающие приглашения - только мастеру, и без самих кодов.
    msg["invites"] = [i.to_dict() for i in invites.scalars()]
    return msg


async def publish_campaign(db: AsyncSession, campaign: Campaign) -> None:
    """Разослать новый список сцен и выгнать тех, кому в своей сцене больше нельзя.

    Игрок, чья сцена перестала быть активной, сначала получает, куда
    переходить, а потом сервер сам закрывает его сокет: полагаться на то,
    что клиент уйдёт сам, нельзя - иначе модифицированный клиент остался
    бы смотреть, как ГМ готовит следующую сцену.
    """
    gm_view = await campaign_view(db, campaign, Actor(id="", name="", is_gm=True))
    player_view = protocol.campaign(campaign.active_scene_id, None, gm_view["users"])
    existing = {s["id"] for s in gm_view["scenes"]}
    alive = {u["id"] for u in gm_view["users"]}
    for scene_id, ws, actor in hub.connections():
        await hub.send(ws, gm_view if actor.is_gm else player_view)
        # Удалённого игрока выгоняем сразу, а не когда он сам отключится.
        gone = actor.id not in alive
        if gone or scene_id not in existing or not can_see(actor, campaign, scene_id):
            hub.leave(scene_id, ws)
            try:
                await ws.close(code=4000)
            except Exception:
                pass


def message_for(message: dict, actor: Actor) -> dict:
    """Сообщение чата глазами получателя.

    Скрытый бросок мастера игроку - заглушка: кто бросил, и всё. Ни
    формулы, ни кубов, ни итога: прятать на клиенте бесполезно, всё
    пришедшее видно в DevTools.
    """
    roll = message.get("roll") or {}
    if not roll.get("hidden") or actor.is_gm or actor.id == message.get("author_id"):
        return message
    return {
        "id": message["id"],
        "author": message["author"],
        "author_id": message["author_id"],
        "text": "",
        "kind": "hidden_roll",
        "roll": None,
        "created_at": message["created_at"],
    }


def combat_for(combat: dict | None, actor: Actor) -> dict | None:
    """Бой глазами получателя: игроку - без скрытых участников (засада)."""
    if combat is None or actor.is_gm:
        return combat
    return {**combat, "entries": [e for e in combat["entries"] if not e.get("hidden")]}


def token_for(token: dict, actor: Actor) -> dict:
    """Токен глазами получателя: хиты моба видит ГМ и владелец токена.
    Игроку они бы выдали, сколько осталось добить."""
    if actor.is_gm or token.get("hp") is None or token.get("owner_id") == actor.id:
        return token
    return {**token, "hp": None}


def event_for(actor: Actor, name: str, seq: int, payload: dict, hidden, cmd_id: str | None) -> dict:
    """Событие сцены глазами получателя.

    Токены слоя ГМ и то, что под туманом, игроку не уходят. Но seq сцены у всех один, и если
    просто не отправить событие, клиент увидит разрыв нумерации и
    перезапросит весь снапшот. Поэтому - пустое событие с тем же seq:
    порядок сохранён, содержимого нет.
    """
    if name == "combat.updated":
        payload = {"combat": combat_for(payload["combat"], actor)}
    if isinstance(payload.get("token"), dict):
        payload = {**payload, "token": token_for(payload["token"], actor)}
    if hidden is None:
        return protocol.event(name, seq, payload, cmd_id)
    if hidden["kind"] == "fog":
        # Туман: мастеру - только сам туман; игроку - ещё что у него
        # появилось (вышло из тумана) и что исчезло (ушло под туман).
        if actor.is_gm:
            return protocol.event(name, seq, payload, cmd_id)
        extra: dict = {"add_tokens": [], "remove_tokens": [], "add_walls": [], "remove_walls": []}
        for c in hidden["changes"]:
            b, a = _visible(c, actor, 0), _visible(c, actor, 1)
            if b == a:
                continue
            if c["kind"] == "token":
                extra["add_tokens" if a else "remove_tokens"].append(token_for(c["full"], actor) if a else c["id"])
            else:
                extra["add_walls" if a else "remove_walls"].append(c["full"] if a else c["id"])
        return protocol.event(name, seq, {**payload, **extra}, cmd_id)
    if actor.is_gm:
        return protocol.event(name, seq, payload, cmd_id)
    kind = hidden["kind"]
    before, after = _visible(hidden, actor, 0), _visible(hidden, actor, 1)
    if not before and not after:
        return protocol.event("noop", seq, {}, None)
    obj_id = payload.get("id") or payload.get(kind, {}).get("id")
    if before and not after:  # был виден - спрятали (слой ГМ или туман)
        return protocol.event(f"{kind}.removed", seq, {"id": obj_id}, cmd_id)
    if after and not before:  # был скрыт - показали
        full = hidden["full"]
        return protocol.event(f"{kind}.added", seq, {kind: token_for(full, actor) if kind == "token" else full}, cmd_id)
    return protocol.event(name, seq, payload, cmd_id)


def _visible(mark: dict, actor: Actor, index: int) -> bool:
    """Видит ли игрок объект до (0) или после (1) команды. Слой ГМ прячет от
    всех игроков; туман - от всех, кроме владельца токена (свой персонаж в
    закрытой комнате не пропадает)."""
    if (mark.get("layer") or (False, False))[index]:
        return False
    if (mark.get("fog") or (False, False))[index] and (mark.get("owner") is None or mark.get("owner") != actor.id):
        return False
    return True


async def scene_snapshot(db: AsyncSession, scene_id: str, actor: Actor) -> dict | None:
    scene = (
        await db.execute(
            select(Scene)
            .where(Scene.id == scene_id)
            .options(selectinload(Scene.tokens), selectinload(Scene.walls))
        )
    ).scalar_one_or_none()
    if scene is None:
        return None

    messages = (
        (
            await db.execute(
                select(Message)
                .where(Message.campaign_id == scene.campaign_id)
                .order_by(Message.created_at.desc())
                .limit(100)
            )
        )
        .scalars()
        .all()
    )

    fog_rects = json.loads(scene.fog_json) if scene.fog_json else []
    return {
        "id": scene.id,
        "seq": scene.seq,
        "name": scene.name,
        "width": scene.width,
        "height": scene.height,
        "grid_size": scene.grid_size,
        "grid_type": scene.grid_type,
        "background_url": scene.background_url,
        "combat": combat_for(json.loads(scene.combat_json) if scene.combat_json else None, actor),
        # Токены слоя ГМ и то, что под туманом, игроку не отдаём вовсе:
        # прятать на клиенте бесполезно, всё пришедшее видно в DevTools.
        "tokens": [
            token_for(t.to_dict(), actor)
            for t in scene.tokens
            if actor.is_gm
            or (t.layer != "gm" and (t.owner_id == actor.id or not fog.contains_point(fog_rects, t.x, t.y)))
        ],
        "walls": [
            w.to_dict()
            for w in scene.walls
            if actor.is_gm or not fog.covers_segment(fog_rects, w.x1, w.y1, w.x2, w.y2)
        ],
        "fog": fog_rects,
        "messages": [message_for(m.to_dict(), actor) for m in reversed(messages)],
    }


def _image_ext(data: bytes) -> str | None:
    """Тип по сигнатуре, а не по имени файла или Content-Type - их шлёт клиент."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


@app.post("/api/uploads")
async def upload(request: Request, db: AsyncSession = Depends(get_session)) -> dict:
    # Загружать может любой вошедший: игрок - картинку своего токена, ГМ -
    # ещё и карты. Поставить файл картой может только ГМ (scene.update), а
    # картинкой токена - тот, кто может править токен (token.update).
    actor = await require_actor(request, db)
    limit = MAX_UPLOAD_BYTES if actor.is_gm else MAX_PLAYER_UPLOAD_BYTES
    # Тело запроса - сама картинка, без multipart: не нужна лишняя зависимость.
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > limit:
            raise HTTPException(413, f"файл больше {limit // (1024 * 1024)} МБ")

    # SVG не принимаем намеренно: внутри может быть скрипт.
    ext = _image_ext(bytes(data[:16]))
    if ext is None:
        raise HTTPException(415, "нужна картинка PNG, JPEG или WebP")

    # Имя - случайное: исходное имя файла никуда не попадает, обход
    # каталогов через него невозможен.
    name = f"{uuid.uuid4().hex}.{ext}"
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    (UPLOAD_DIR / name).write_bytes(data)
    return {"url": f"/uploads/{name}"}


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True}


def _set_session(response: Response, token: str) -> None:
    # httpOnly - скрипт страницы не прочтёт токен, даже если в чат когда-то
    # пролезет XSS. SameSite=Lax - чужой сайт не отправит от имени игрока
    # ни POST, ни websocket. Secure не ставим: локально всё по http.
    response.set_cookie(
        auth.SESSION_COOKIE, token, httponly=True, samesite="lax",
        max_age=auth.SESSION_MAX_AGE, path="/",
    )


class LoginBody(BaseModel):
    name: str = ""
    password: str = ""


class InviteBody(BaseModel):
    token: str
    name: str | None = None
    password: str = ""


class GmLoginBody(BaseModel):
    key: str
    name: str | None = None
    password: str | None = None


@app.get("/api/me")
async def me(request: Request, db: AsyncSession = Depends(get_session)) -> dict | None:
    # Без сессии - 200 и null, а не 401: это обычный ответ "не вошёл",
    # и каждый заход на экран входа не должен краснеть ошибкой в консоли.
    actor = await session_actor(db, request.cookies)
    return {"id": actor.id, "name": actor.name, "is_gm": actor.is_gm} if actor else None


# Неудачные входы: по паре адрес+имя (подбор пароля к одному игроку), по
# имени с любого адреса и по адресу (перебор разных имён) - кроме loopback.
# Ключ ГМ - как имя "ключ ГМ".
login_limiter = LoginLimiter(LOGIN_MAX_FAILURES, LOGIN_WINDOW)
ip_limiter = LoginLimiter(LOGIN_MAX_FAILURES_PER_IP, LOGIN_WINDOW)
name_limiter = LoginLimiter(LOGIN_MAX_FAILURES_PER_NAME, LOGIN_NAME_WINDOW)


def _is_loopback(ip: str) -> bool:
    """127.0.0.1 и ::1 - не один человек, а все, кто пришёл через Porthole
    или туннель без X-Forwarded-For. Счётчик по такому адресу заблокировал
    бы весь стол из-за одного игрока, ошибшегося паролем."""
    try:
        return ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return False


def client_ip(request: Request) -> str:
    """Адрес клиента. За туннелем все приходят с 127.0.0.1, настоящий адрес -
    в X-Forwarded-For; верим ему, только если это включено (TRUST_PROXY) и
    запрос пришёл с этой же машины. Берём последний адрес: его дописал наш
    прокси, всё левее мог прислать сам клиент."""
    host = request.client.host if request.client else "?"
    if TRUST_PROXY and host in ("127.0.0.1", "::1"):
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[-1].strip()
        if forwarded:
            return forwarded
    return host


def _check_login_limit(ip: str, who: str) -> None:
    waits = [login_limiter.retry_after(f"{ip}|{who}"), name_limiter.retry_after(who)]
    if not _is_loopback(ip):
        waits.append(ip_limiter.retry_after(ip))
    wait = max(w or 0 for w in waits)
    if wait:
        minutes = max(1, round(wait / 60))
        raise HTTPException(
            429, f"слишком много неудачных попыток - подожди {minutes} мин", headers={"Retry-After": str(wait)}
        )


def _login_failed(ip: str, who: str) -> None:
    login_limiter.fail(f"{ip}|{who}")
    name_limiter.fail(who)
    if not _is_loopback(ip):
        ip_limiter.fail(ip)


@app.post("/api/login")
async def login(
    body: LoginBody, request: Request, response: Response, db: AsyncSession = Depends(get_session)
) -> dict:
    ip, who = client_ip(request), body.name.strip().casefold()
    # До проверки пароля: argon2 дорогой, перебор не должен его гонять.
    _check_login_limit(ip, who)
    campaign = await get_campaign(db)
    user = await auth.find_user(db, campaign, body.name.strip())
    # Один ответ на "нет такого" и "неверный пароль": иначе вход
    # подсказывал бы, какие имена существуют.
    if not await auth.verify_password(user.password_hash if user else None, body.password):
        _login_failed(ip, who)
        raise HTTPException(401, "неверное имя или пароль")
    login_limiter.reset(f"{ip}|{who}")
    _set_session(response, await auth.create_session(db, user))
    await db.commit()
    return user.to_dict()


@app.post("/api/gm/login")
async def gm_login(
    body: GmLoginBody, request: Request, response: Response, db: AsyncSession = Depends(get_session)
) -> dict:
    """Вход мастера по ключу. Первый раз - заодно создать его аккаунт.

    Потом ключ - запасной вход, если пароль забыт: кто знает ключ, тот и
    так владеет сервером.
    """
    ip = client_ip(request)
    _check_login_limit(ip, "ключ ГМ")
    if not is_gm_key(body.key):
        _login_failed(ip, "ключ ГМ")
        raise HTTPException(403, "ключ ГМ не подошёл")
    login_limiter.reset(f"{ip}|ключ ГМ")
    async with hub.lock("campaign"):
        campaign = await get_campaign(db)
        gm = (
            await db.execute(select(User).where(User.campaign_id == campaign.id, User.is_gm).limit(1))
        ).scalar_one_or_none()
        if gm is None:
            if body.name is None or body.password is None:
                return {"needs_setup": True}
            try:
                gm = await auth.create_user(db, campaign, body.name, body.password, is_gm=True)
            except auth.AuthError as exc:
                raise HTTPException(400, str(exc))
        _set_session(response, await auth.create_session(db, gm))
        await db.commit()
    return gm.to_dict()


@app.post("/api/invite/info")
async def invite_info(body: InviteBody, db: AsyncSession = Depends(get_session)) -> dict:
    """Что за приглашение: новый игрок или сброс пароля (и чей)."""
    invite = await auth.find_invite(db, body.token)
    await db.commit()  # просроченное find_invite удаляет
    if invite is None:
        raise HTTPException(404, "приглашение не найдено или истекло")
    if invite.user_id:
        user = await db.get(User, invite.user_id)
        return {"kind": "reset", "name": user.name if user else None}
    return {"kind": "join"}


@app.post("/api/invite/accept")
async def invite_accept(
    body: InviteBody, response: Response, db: AsyncSession = Depends(get_session)
) -> dict:
    async with hub.lock("campaign"):
        campaign = await get_campaign(db)
        invite = await auth.find_invite(db, body.token)
        if invite is None:
            await db.commit()
            raise HTTPException(404, "приглашение не найдено или истекло")
        try:
            user = await auth.accept_invite(db, campaign, invite, body.name, body.password)
        except auth.AuthError as exc:
            raise HTTPException(400, str(exc))
        _set_session(response, await auth.create_session(db, user))
        await db.commit()
        # Сброс пароля: открытые сокеты со старыми сессиями - выгнать.
        # Новый игрок: мастеру - обновлённый список.
        if invite.user_id:
            await kick_user(user.id)
        await publish_campaign(db, campaign)
    return user.to_dict()


@app.post("/api/logout")
async def logout(request: Request, response: Response, db: AsyncSession = Depends(get_session)) -> dict:
    token = request.cookies.get(auth.SESSION_COOKIE)
    await auth.drop_session(db, token)
    await db.commit()
    response.delete_cookie(auth.SESSION_COOKIE, path="/")
    # Вкладки с этой же сессией (тот же браузер) - на экран входа. Другие
    # входы игрока (телефон, второй компьютер) не трогаем.
    if token:
        await kick(lambda actor: actor.session == auth.session_id(token))
    return {"ok": True}


@app.get("/api/campaign")
async def get_campaign_view(request: Request, db: AsyncSession = Depends(get_session)) -> dict:
    actor = await require_actor(request, db)
    return await campaign_view(db, await get_campaign(db), actor)


@app.get("/api/characters")
async def list_characters(request: Request, db: AsyncSession = Depends(get_session)) -> list[dict]:
    # Игрок получает только свои листы, ГМ - все. Чужие игроку не уходят
    # вовсе: прятать на клиенте бесполезно, всё пришедшее видно в DevTools.
    actor = await require_actor(request, db)
    campaign = await get_campaign(db)
    query = select(Character).where(Character.campaign_id == campaign.id)
    if not actor.is_gm:
        query = query.where(Character.owner_id == actor.id)
    rows = await db.execute(query.order_by(Character.created_at))
    return [c.to_dict() for c in rows.scalars()]


@app.get("/api/scenes")
async def list_scenes(request: Request, db: AsyncSession = Depends(get_session)) -> list[dict]:
    # Игроку - только активная сцена: названия заготовок ГМ ему знать незачем.
    campaign = await get_campaign(db)
    actor = await require_actor(request, db)
    scenes = (
        await db.execute(
            select(Scene).where(Scene.campaign_id == campaign.id).order_by(Scene.created_at)
        )
    ).scalars()
    return [{"id": s.id, "name": s.name} for s in scenes if can_see(actor, campaign, s.id)]


@app.get("/api/scenes/{scene_id}")
async def get_scene(scene_id: str, request: Request, db: AsyncSession = Depends(get_session)):
    # Через этот адрес клиент перезапрашивает снапшот. Без проверки игрок
    # вытащил бы им скрытую сцену целиком.
    if not can_see(await require_actor(request, db), await get_campaign(db), scene_id):
        raise HTTPException(404, "scene not found")
    data = await scene_snapshot(db, scene_id, await require_actor(request, db))
    return data or {"error": "scene not found"}


def origin_allowed(websocket: WebSocket) -> bool:
    """Websocket открыт со своей страницы, а не с чужого сайта.

    Браузер шлёт cookie сессии на websocket с любой страницы, поэтому без
    этой проверки чужой сайт мог бы открыть сокет от имени игрока
    (SameSite=Lax от этого тоже защищает, это второй слой).

    Пускаем адреса из FRONTEND_URL и страницу с того же адреса, куда идёт
    сокет (Origin совпадает с Host): иначе отвалились бы 127.0.0.1 и
    адрес в локальной сети, по которому заходят игроки. Без Origin - не
    браузер (smoke_test, скрипты); подделать запрос от имени игрока может
    только браузер на чужом сайте, а он Origin шлёт всегда.
    """
    origin = websocket.headers.get("origin")
    if origin is None:
        return True
    origin = origin.rstrip("/")
    host = websocket.headers.get("host", "")
    if origin in FRONTEND_URLS or origin in (f"http://{host}", f"https://{host}"):
        return True
    # Porthole: игрок открывает http://127.0.0.1:<свой порт>, мастер слушает
    # 127.0.0.1:8000. Порты могут не совпасть, если что-то по дороге перепишет
    # Host, - loopback-страница к loopback-серверу пускается с любым портом.
    # Прав это не даёт: кто подключился, решает только сессия.
    return _loopback_host(urlsplit(origin).hostname) and _loopback_host(host.rsplit(":", 1)[0].strip("[]"))


def _loopback_host(name: str | None) -> bool:
    if not name:
        return False
    if name == "localhost":
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


@app.websocket("/ws/scene/{scene_id}")
async def scene_socket(websocket: WebSocket, scene_id: str):
    # Кто подключился - только из сессии. Имени в адресе больше нет: его
    # мог подставить любой.
    if not origin_allowed(websocket):
        # До accept: сервер отвечает на рукопожатие отказом (403).
        await websocket.close(code=4403)
        return
    await websocket.accept()

    async with SessionLocal() as db:
        actor = await session_actor(db, websocket.cookies)
        if actor is None:
            await websocket.send_json({"type": "auth_required"})
            await websocket.close(code=4401)
            return
        campaign = await get_campaign(db)
        snap = await scene_snapshot(db, scene_id, actor) if can_see(actor, campaign, scene_id) else None
        if snap is None:
            # Скрытая или удалённая сцена - говорим, какая активна, и закрываем.
            # Отличать "нет такой" от "скрыта" не будем: это тоже утечка.
            await websocket.send_json(await campaign_view(db, campaign, actor))
            await websocket.close(code=4000)
            return
        view = await campaign_view(db, campaign, actor)

    # В рассылку - сразу, как собран снапшот, а не после отправки: иначе
    # всё, что случилось, пока снапшот летел, клиент терял. События сцены
    # это переживали (разрыв seq -> перезапрос), а чат (без seq) пропадал
    # молча. Событие, обогнавшее снапшот, клиент увидит как разрыв seq и
    # перезапросит состояние.
    await hub.join(scene_id, websocket, actor)
    try:
        # Отправка - уже под try: ушёл клиент, пока летел снапшот, -
        # finally всё равно уберёт его из рассылки.
        you = {"id": actor.id, "name": actor.name, "is_gm": actor.is_gm}
        if actor.is_gm:
            # Адрес туннеля - мастеру, для ссылок-приглашений. Снапшот
            # приходит при каждом подключении, в отличие от ответа на вход.
            you["public_url"] = PUBLIC_URL
        await websocket.send_json(protocol.snapshot(snap["seq"], snap, you))
        await websocket.send_json(view)
        await hub.broadcast_all(protocol.presence(hub.users()))
        while True:
            raw = await websocket.receive_text()
            await handle_raw(websocket, scene_id, actor, raw)
    # Второе - когда сокет закрыли с нашей стороны (publish_campaign) или
    # отправка в уже закрывшийся сокет не удалась: тогда starlette бросает
    # не WebSocketDisconnect, а WebSocketDisconnected.
    except (WebSocketDisconnect, WebSocketDisconnected):
        pass
    finally:
        hub.leave(scene_id, websocket)
        await hub.broadcast_all(protocol.presence(hub.users()))


async def handle_raw(websocket: WebSocket, scene_id: str, actor: Actor, raw: str) -> None:
    try:
        command = protocol.Command.model_validate_json(raw)
    except ValidationError:
        await hub.send(websocket, protocol.error("битая команда"))
        return

    if command.name in CAMPAIGN_HANDLERS:
        await handle_campaign(websocket, actor, command)
        return

    if command.name in EPHEMERAL:
        # Пинг и подобное: проверить и разослать, состояние сцены не трогаем.
        async with SessionLocal() as db:
            scene = await db.get(Scene, scene_id)
        if scene is None:
            return
        try:
            message = EPHEMERAL[command.name](scene, actor, command.payload)
        except CommandError as exc:
            await hub.send(websocket, protocol.error(str(exc), command.id))
            return
        if message is not None:
            await hub.broadcast(scene_id, message)
        return

    handler = HANDLERS.get(command.name)
    if handler is None:
        await hub.send(websocket, protocol.error(f"неизвестная команда {command.name}", command.id))
        return

    # Все команды одной сцены применяются строго по очереди.
    async with hub.lock(scene_id):
        async with SessionLocal() as db:
            scene = await db.get(Scene, scene_id)
            if scene is None:
                await hub.send(websocket, protocol.error("сцена не найдена", command.id))
                return
            try:
                name, payload = await handler(db, scene, actor, command.payload)
                scene.seq += 1
                seq = scene.seq
                await db.commit()
            except CommandError as exc:
                await db.rollback()
                await hub.send(websocket, protocol.error(str(exc), command.id))
                return
            except Exception:
                # Ошибка в одной команде не должна рвать сокет: raise вывел бы
                # из цикла приёма, и игрок потерял бы соединение. В лог - и дальше.
                await db.rollback()
                log.exception("команда %s упала", command.name)
                await hub.send(websocket, protocol.error("внутренняя ошибка", command.id))
                return

        hidden = payload.pop(HIDDEN, None)
        await hub.broadcast_each(scene_id, lambda actor: event_for(actor, name, seq, payload, hidden, command.id))


async def handle_campaign(websocket: WebSocket, actor: Actor, command: protocol.Command) -> None:
    """Чат и список сцен: общие на кампанию, мимо seq сцены."""
    handler = CAMPAIGN_HANDLERS[command.name]
    async with hub.lock("campaign"):
        async with SessionLocal() as db:
            campaign = await get_campaign(db)
            try:
                name, payload = await handler(db, campaign, actor, command.payload)
                await db.commit()
            except CommandError as exc:
                await db.rollback()
                await hub.send(websocket, protocol.error(str(exc), command.id))
                return
            except Exception:
                # Как и в командах сцены: в лог, сокет живёт дальше.
                await db.rollback()
                log.exception("команда %s упала", command.name)
                await hub.send(websocket, protocol.error("внутренняя ошибка", command.id))
                return

            if name == "chat.said":
                message = payload["message"]
                await hub.broadcast_all_each(lambda a: protocol.chat(message_for(message, a)))
                return
            if name.startswith("character."):
                if name == "character.created":
                    await hub.send(websocket, protocol.reply(name, payload, command.id))
                await publish_character(name, payload)
                return
            await hub.send(websocket, protocol.reply(name, payload, command.id))
            await publish_campaign(db, campaign)


async def publish_character(name: str, payload: dict) -> None:
    """Лист - только владельцу и мастерам. Остальным не уходит ни байта."""
    if name == "character.deleted":
        owner_id = payload["owner_id"]
        msg = {"type": "character_deleted", "id": payload["id"]}
    else:
        owner_id = payload["character"]["owner_id"]
        msg = {"type": "character", "character": payload["character"]}
    for _, ws, actor in hub.connections():
        if actor.is_gm or actor.id == owner_id:
            await hub.send(ws, msg)


async def kick_user(user_id: str) -> None:
    """Закрыть все сокеты пользователя: его сессии больше не действуют."""
    await kick(lambda actor: actor.id == user_id)


async def kick(match) -> None:
    """Закрыть сокеты, чья сессия больше не действует, и отправить на вход."""
    for scene_id, ws, actor in hub.connections():
        if match(actor):
            hub.leave(scene_id, ws)
            await hub.send(ws, {"type": "auth_required"})
            try:
                await ws.close(code=4401)
            except Exception:
                pass


# Монтируется последним, чтобы не перекрыть маршруты выше.
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# Собранный фронт - на том же порту, что и API. Тоже в самом конце: путь
# "/{path}" ловит всё, что не поймали маршруты выше.
if (WEB_DIST / "index.html").is_file():
    _dist = WEB_DIST.resolve()
    # Имена в assets с хешем содержимого - их можно кешировать.
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def web_app(path: str):
        # Неизвестный /api/... - честный 404, а не страница приложения.
        if path.startswith(("api/", "ws/", "uploads/")):
            raise HTTPException(404)
        file = (_dist / path).resolve()
        # resolve + is_relative_to: "../" не выводит за пределы dist.
        if path and file.is_file() and file.is_relative_to(_dist):
            return FileResponse(file)
        # Всё остальное - само приложение (?gm=, ?invite= и т.п. разбирает
        # оно). no-cache: после пересборки браузер возьмёт новый index.html.
        return FileResponse(_dist / "index.html", headers={"Cache-Control": "no-cache"})

from __future__ import annotations

import json
from contextlib import asynccontextmanager

import uuid

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from . import protocol
from .config import FRONTEND_URL, MAX_UPLOAD_BYTES, UPLOAD_DIR
from .db import SessionLocal, get_session, init_db
from .handlers import HANDLERS, CommandError
from .hub import hub
from .models import Campaign, Message, Scene
from .roles import GM_COOKIE, GM_KEY, Actor, is_gm_key


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await ensure_demo_scene()
    print(f"\n  Ссылка ГМ: {FRONTEND_URL}/?gm={GM_KEY}\n  Не показывай её игрокам.\n", flush=True)
    yield


app = FastAPI(title="Lanterna VTT", lifespan=lifespan)

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
        await db.commit()


async def scene_snapshot(db: AsyncSession, scene_id: str) -> dict | None:
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
                .where(Message.scene_id == scene_id)
                .order_by(Message.created_at.desc())
                .limit(100)
            )
        )
        .scalars()
        .all()
    )

    return {
        "id": scene.id,
        "seq": scene.seq,
        "name": scene.name,
        "width": scene.width,
        "height": scene.height,
        "grid_size": scene.grid_size,
        "grid_type": scene.grid_type,
        "background_url": scene.background_url,
        "tokens": [t.to_dict() for t in scene.tokens],
        "walls": [w.to_dict() for w in scene.walls],
        "messages": [m.to_dict() for m in reversed(messages)],
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
async def upload(request: Request) -> dict:
    # Карты загружает только ГМ - он же их и ставит на сцену.
    if not is_gm_key(request.cookies.get(GM_COOKIE)):
        raise HTTPException(403, "загружать карты может только ГМ")
    # Тело запроса - сама картинка, без multipart: не нужна лишняя зависимость.
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"файл больше {MAX_UPLOAD_BYTES // (1024 * 1024)} МБ")

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


@app.get("/api/scenes")
async def list_scenes(db: AsyncSession = Depends(get_session)) -> list[dict]:
    scenes = (await db.execute(select(Scene))).scalars().all()
    return [{"id": s.id, "name": s.name} for s in scenes]


@app.get("/api/scenes/{scene_id}")
async def get_scene(scene_id: str, db: AsyncSession = Depends(get_session)):
    data = await scene_snapshot(db, scene_id)
    return data or {"error": "scene not found"}


@app.websocket("/ws/scene/{scene_id}")
async def scene_socket(websocket: WebSocket, scene_id: str, user: str = "anon"):
    # TODO: это не аутентификация. Имя приходит query-параметром и никак
    # не проверяется. Перед любым публичным хостингом - заменить.
    # ГМ определяется ключом, а не именем: см. roles.py.
    actor = Actor(name=(user or "anon")[:100], is_gm=is_gm_key(websocket.cookies.get(GM_COOKIE)))

    await websocket.accept()

    async with SessionLocal() as db:
        snap = await scene_snapshot(db, scene_id)
        if snap is None:
            await websocket.send_json(protocol.error("сцена не найдена"))
            await websocket.close()
            return
        scene = await db.get(Scene, scene_id)
        you = {"name": actor.name, "is_gm": actor.is_gm}
        await websocket.send_json(protocol.snapshot(scene.seq, snap, you))

    await hub.join(scene_id, websocket, actor.name)
    await hub.broadcast(scene_id, protocol.presence(hub.users(scene_id)))

    try:
        while True:
            raw = await websocket.receive_text()
            await handle_raw(websocket, scene_id, actor, raw)
    except WebSocketDisconnect:
        pass
    finally:
        hub.leave(scene_id, websocket)
        await hub.broadcast(scene_id, protocol.presence(hub.users(scene_id)))


async def handle_raw(websocket: WebSocket, scene_id: str, actor: Actor, raw: str) -> None:
    try:
        command = protocol.Command.model_validate_json(raw)
    except ValidationError:
        await hub.send(websocket, protocol.error("битая команда"))
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
            except CommandError as exc:
                await db.rollback()
                await hub.send(websocket, protocol.error(str(exc), command.id))
                return
            except Exception:
                await db.rollback()
                await hub.send(websocket, protocol.error("внутренняя ошибка", command.id))
                raise

            scene.seq += 1
            seq = scene.seq
            await db.commit()

        await hub.broadcast(scene_id, protocol.event(name, seq, payload, command.id))


# Монтируется последним, чтобы не перекрыть маршруты выше.
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

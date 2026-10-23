from __future__ import annotations

import json
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from . import protocol
from .db import SessionLocal, get_session, init_db
from .handlers import HANDLERS, CommandError
from .hub import hub
from .models import Campaign, Message, Scene


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await ensure_demo_scene()
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
    user = (user or "anon")[:100]

    await websocket.accept()

    async with SessionLocal() as db:
        snap = await scene_snapshot(db, scene_id)
        if snap is None:
            await websocket.send_json(protocol.error("сцена не найдена"))
            await websocket.close()
            return
        scene = await db.get(Scene, scene_id)
        await websocket.send_json(protocol.snapshot(scene.seq, snap))

    await hub.join(scene_id, websocket, user)
    await hub.broadcast(scene_id, protocol.presence(hub.users(scene_id)))

    try:
        while True:
            raw = await websocket.receive_text()
            await handle_raw(websocket, scene_id, user, raw)
    except WebSocketDisconnect:
        pass
    finally:
        hub.leave(scene_id, websocket)
        await hub.broadcast(scene_id, protocol.presence(hub.users(scene_id)))


async def handle_raw(websocket: WebSocket, scene_id: str, user: str, raw: str) -> None:
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
                name, payload = await handler(db, scene, user, command.payload)
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

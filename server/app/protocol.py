"""Конверты протокола. См. ARCHITECTURE.md.

cmd:      клиент -> сервер
event:    сервер -> всем в сцене
snapshot: сервер -> одному клиенту при подключении
error:    сервер -> одному клиенту
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Command(BaseModel):
    type: Literal["cmd"] = "cmd"
    id: str | None = None  # client-generated, возвращается в событии
    name: str
    payload: dict[str, Any] = Field(default_factory=dict)


def event(name: str, seq: int, payload: dict, cmd_id: str | None = None) -> dict:
    return {
        "type": "event",
        "seq": seq,
        "name": name,
        "payload": payload,
        "cmd_id": cmd_id,
    }


def snapshot(seq: int, scene: dict, you: dict) -> dict:
    # you - кем сервер считает этого клиента. Интерфейсу нужно знать,
    # показывать ли инструменты ГМ; права всё равно проверяет сервер.
    return {"type": "snapshot", "seq": seq, "scene": scene, "you": you}


def error(message: str, cmd_id: str | None = None) -> dict:
    return {"type": "error", "message": message, "cmd_id": cmd_id}


def presence(users: list[str]) -> dict:
    return {"type": "presence", "users": users}


def chat(message: dict) -> dict:
    # Чат общий на кампанию и идёт мимо seq сцены: его получают и те, кто
    # сейчас в другой сцене, а их нумерация событий от этого ломаться не должна.
    return {"type": "chat", "message": message}


def campaign(active_scene_id: str | None, scenes: list[dict] | None) -> dict:
    # scenes - только для ГМ. Игрок узнаёт лишь, какая сцена активна:
    # названия заготовок ему знать незачем.
    msg: dict = {"type": "campaign", "active_scene_id": active_scene_id}
    if scenes is not None:
        msg["scenes"] = scenes
    return msg


def reply(name: str, payload: dict, cmd_id: str | None) -> dict:
    # Ответ одному отправителю на команду кампании (например, id новой сцены).
    return {"type": "reply", "name": name, "payload": payload, "cmd_id": cmd_id}

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


def snapshot(seq: int, scene: dict) -> dict:
    return {"type": "snapshot", "seq": seq, "scene": scene}


def error(message: str, cmd_id: str | None = None) -> dict:
    return {"type": "error", "message": message, "cmd_id": cmd_id}


def presence(users: list[str]) -> dict:
    return {"type": "presence", "users": users}

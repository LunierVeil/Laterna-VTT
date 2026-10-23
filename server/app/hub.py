"""Комнаты и рассылка.

Важная деталь: на каждую сцену свой asyncio.Lock. Все команды сцены
применяются строго по одной. Это убирает целый класс гонок (двое
двигают один токен, двое одновременно создают стену) ценой того, что
команды одной сцены не параллелятся. Для VTT это совершенно не узкое
место - там единицы действий в секунду.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        self._rooms: dict[str, dict[WebSocket, str]] = defaultdict(dict)
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    def lock(self, scene_id: str) -> asyncio.Lock:
        return self._locks[scene_id]

    async def join(self, scene_id: str, ws: WebSocket, user: str) -> None:
        self._rooms[scene_id][ws] = user

    def leave(self, scene_id: str, ws: WebSocket) -> None:
        self._rooms[scene_id].pop(ws, None)
        if not self._rooms[scene_id]:
            self._rooms.pop(scene_id, None)

    def users(self, scene_id: str) -> list[str]:
        return sorted(set(self._rooms.get(scene_id, {}).values()))

    async def broadcast(self, scene_id: str, message: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._rooms.get(scene_id, {})):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.leave(scene_id, ws)

    async def send(self, ws: WebSocket, message: dict) -> None:
        try:
            await ws.send_json(message)
        except Exception:
            pass


hub = Hub()

"""Комнаты и рассылка.

Важная деталь: на каждую сцену свой asyncio.Lock. Все команды сцены
применяются строго по одной. Это убирает целый класс гонок (двое
двигают один токен, двое одновременно создают стену) ценой того, что
команды одной сцены не параллелятся. Для VTT это совершенно не узкое
место - там единицы действий в секунду.

Кампания пока одна, поэтому "все комнаты хаба" и есть вся кампания:
туда уходят чат, присутствие и изменения списка сцен.
"""

from __future__ import annotations

import asyncio
from collections import defaultdict

from fastapi import WebSocket

from .roles import Actor


class Hub:
    def __init__(self) -> None:
        self._rooms: dict[str, dict[WebSocket, Actor]] = defaultdict(dict)
        self._locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

    def lock(self, scene_id: str) -> asyncio.Lock:
        return self._locks[scene_id]

    async def join(self, scene_id: str, ws: WebSocket, actor: Actor) -> None:
        self._rooms[scene_id][ws] = actor

    def leave(self, scene_id: str, ws: WebSocket) -> None:
        self._rooms[scene_id].pop(ws, None)
        if not self._rooms[scene_id]:
            self._rooms.pop(scene_id, None)

    def users(self) -> list[str]:
        """Кто онлайн во всей кампании, в какой бы сцене ни был."""
        return sorted({a.name for room in self._rooms.values() for a in room.values()})

    def connections(self) -> list[tuple[str, WebSocket, Actor]]:
        return [(sid, ws, a) for sid, room in self._rooms.items() for ws, a in room.items()]

    async def broadcast_all(self, message: dict) -> None:
        for _, ws, _ in self.connections():
            await self.send(ws, message)

    async def broadcast_all_each(self, make) -> None:
        """Всей кампании, но каждому своё: make(actor) -> dict."""
        for _, ws, actor in self.connections():
            await self.send(ws, make(actor))

    async def broadcast(self, scene_id: str, message: dict) -> None:
        for ws in list(self._rooms.get(scene_id, {})):
            await self.send(ws, message)

    async def broadcast_each(self, scene_id: str, make) -> None:
        for ws, actor in list(self._rooms.get(scene_id, {}).items()):
            await self.send(ws, make(actor))

    async def send(self, ws: WebSocket, message: dict) -> None:
        try:
            async with asyncio.timeout(5):
                await ws.send_json(message)
        except Exception:
            for sid, candidate, _ in self.connections():
                if candidate is ws:
                    self.leave(sid, ws)
            try:
                async with asyncio.timeout(2):
                    await ws.close(code=1011)
            except Exception:
                pass


hub = Hub()

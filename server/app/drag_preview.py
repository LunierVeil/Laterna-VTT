"""Transient, recipient-filtered drag streams. No scene writes or seq increments."""
from __future__ import annotations

import json
import math
import time
import uuid
from collections import OrderedDict, defaultdict
from dataclasses import dataclass, field

from . import fog
from .handlers import CommandError
from .models import Token


@dataclass
class Stream:
    ws: object
    actor: object
    scene_id: str
    token_id: str
    drag_id: str
    step: int
    base_seq: int
    x: float
    y: float
    origin_x: float
    origin_y: float
    updated: float
    readers: set = field(default_factory=set)


class DragPreviews:
    INTERVAL = 0.1
    TTL = 2.0

    def __init__(self, hub, clock=time.monotonic):
        self.hub, self.clock = hub, clock
        self.streams = {}
        self.closed = OrderedDict()
        self.last = {}
        self.latest = OrderedDict()
        self.epoch = defaultdict(int)

    def allowed(self, ws):
        now = self.clock()
        if now - self.last.get(ws, float('-inf')) < self.INTERVAL:
            return False
        self.last[ws] = now
        return True

    def _closed(self, ws, drag_id):
        return self.closed.get((ws, drag_id), 0) > self.clock()

    async def close(self, stream, final=True):
        if self.streams.get(stream.ws) is stream:
            self.streams.pop(stream.ws, None)
        if final:
            self.closed[(stream.ws, stream.drag_id)] = self.clock() + 15
        while len(self.closed) > 2048:
            self.closed.popitem(last=False)
        message = {"type": "token_preview", "end": True, "final": final, "id": stream.token_id, "drag_id": stream.drag_id, "step": stream.step + (1 if final else 0), "base_seq": stream.base_seq}
        for ws in list(stream.readers):
            await self.hub.send(ws, message)

    async def drop_socket(self, ws):
        stream = self.streams.get(ws)
        if stream:
            await self.close(stream)
        self.last.pop(ws, None)
        for stream in self.streams.values():
            stream.readers.discard(ws)
        for key in list(self.latest):
            if key[0] is ws: self.latest.pop(key, None)

    async def clear_token(self, scene_id, token_id, source=None):
        for stream in list(self.streams.values()):
            if stream.scene_id == scene_id and stream.token_id == token_id and (source is None or stream.ws is source):
                await self.close(stream)

    async def clear_scene(self, scene_id=None):
        scenes = {scene_id} if scene_id is not None else {sid for sid, _, _ in self.hub.connections()} | {s.scene_id for s in self.streams.values()}
        for sid in scenes: self.epoch[sid] += 1
        for stream in list(self.streams.values()):
            if scene_id is None or stream.scene_id == scene_id:
                await self.close(stream)

    async def expire(self):
        now = self.clock()
        # Called outside scene locks; close() removes the stream synchronously
        # before awaiting sends, so an expired stream cannot supersede a new one.
        for stream in list(self.streams.values()):
            if now - stream.updated >= self.TTL:
                await self.close(stream, final=False)
        for key, until in list(self.closed.items()):
            if until <= now:
                self.closed.pop(key, None)

    async def handle(self, db, scene, actor, ws, payload, end=False):
        drag_id = payload.get("drag_id")
        try:
            if not isinstance(drag_id, str) or len(drag_id) != 36:
                raise ValueError()
            uuid.UUID(drag_id)
        except (ValueError, AttributeError):
            raise CommandError("неверный id перемещения")
        old = self.streams.get(ws)
        if end:
            if old and old.drag_id == drag_id:
                await self.close(old)
            else:
                self.closed[(ws, drag_id)] = self.clock() + 15
                while len(self.closed) > 2048:
                    self.closed.popitem(last=False)
            return
        if self._closed(ws, drag_id):
            return
        step, base = payload.get("step"), payload.get("base_seq")
        if type(step) is not int or not 1 <= step <= 2**31 - 1 or type(base) is not int:
            raise CommandError("неверная версия preview")
        if base != scene.seq:
            return
        if step <= self.latest.get((ws, drag_id), 0):
            return
        epoch = self.epoch[scene.id]
        token = await db.get(Token, payload.get("id")) if isinstance(payload.get("id"), str) else None
        if epoch != self.epoch[scene.id] or self._closed(ws, drag_id) or not any(sid == scene.id and peer is ws for sid, peer, _ in self.hub.connections()):
            return
        if token is None or token.scene_id != scene.id:
            raise CommandError("токен не найден")
        regions = json.loads(scene.fog_json or '[]')
        if not actor.is_gm and (token.layer == 'gm' or (token.owner_id != actor.id and fog.contains_point(regions, token.x, token.y))):
            raise CommandError("токен не найден")
        if not actor.is_gm and token.owner_id not in (None, actor.id):
            raise CommandError("нельзя двигать чужой токен")
        coords = []
        for key, maximum in (("x", scene.width), ("y", scene.height)):
            value = payload.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise CommandError("координата preview - конечное число")
            coords.append(max(0, min(maximum, value)))
        if old and (old.drag_id != drag_id or old.token_id != token.id):
            await self.close(old)
            old = None
        stream = old or Stream(ws, actor, scene.id, token.id, drag_id, step, base, *coords, token.x, token.y, self.clock())
        stream.step, stream.base_seq = step, base
        stream.x, stream.y = coords
        stream.updated = self.clock()
        self.streams[ws] = stream
        self.latest[(ws, drag_id)] = step
        while len(self.latest) > 2048: self.latest.popitem(last=False)
        regions = json.loads(scene.fog_json or '[]')
        readers = set()
        previous_readers = set(stream.readers)
        message = {"type": "token_preview", "end": False, "id": token.id, "drag_id": drag_id,
                   "step": step, "base_seq": base, "x": stream.x, "y": stream.y,
                   "origin_x": token.x, "origin_y": token.y, "author": actor.name, "ttl_ms": 2000}
        for sid, peer, viewer in self.hub.connections():
            if self.streams.get(ws) is not stream or self._closed(ws, drag_id):
                return
            if sid != scene.id or peer is ws:
                continue
            visible = viewer.is_gm or (token.layer != 'gm' and (token.owner_id == viewer.id or
                not fog.contains_point(regions, token.x, token.y) and not fog.contains_point(regions, stream.x, stream.y)))
            if visible:
                readers.add(peer)
                stream.readers.add(peer)
                await self.hub.send(peer, message)
            elif peer in previous_readers:
                # No forbidden coordinates or images, only stop a previously seen ghost.
                await self.hub.send(peer, {"type": "token_preview", "end": True, "final": False, "id": token.id, "drag_id": drag_id, "step": step, "base_seq": base})
        stream.readers = readers

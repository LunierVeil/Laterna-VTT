"""Дымовой тест бэкенда. Запускать при живом сервере на :8000.

    python server/smoke_test.py

Проверяет то, что сломать проще всего: порядок seq, подтверждение
команды по cmd_id, блокировку движения стеной и серверный бросок.
"""

from __future__ import annotations

import asyncio
import json
import sys

import httpx
import websockets


BASE = "http://127.0.0.1:8000"
WS = "ws://127.0.0.1:8000"


async def recv_until(ws, predicate, timeout=5.0):
    async def _loop():
        while True:
            msg = json.loads(await ws.recv())
            if predicate(msg):
                return msg

    return await asyncio.wait_for(_loop(), timeout)


async def main() -> int:
    async with httpx.AsyncClient() as client:
        scenes = (await client.get(f"{BASE}/api/scenes")).json()
    if not scenes:
        print("нет сцен")
        return 1
    scene_id = scenes[0]["id"]
    print(f"сцена {scene_id}")

    async with websockets.connect(f"{WS}/ws/scene/{scene_id}?user=gm") as gm, \
            websockets.connect(f"{WS}/ws/scene/{scene_id}?user=player") as player:

        snap = json.loads(await gm.recv())
        assert snap["type"] == "snapshot", snap
        start_seq = snap["seq"]
        print(f"snapshot ok, seq={start_seq}")

        await player.recv()  # snapshot игрока

        # 1. Добавить токен
        await gm.send(json.dumps({
            "type": "cmd", "id": "c1", "name": "token.add",
            "payload": {"name": "Гоблин", "x": 100, "y": 100},
        }))
        ev = await recv_until(gm, lambda m: m.get("name") == "token.added")
        token_id = ev["payload"]["token"]["id"]
        assert ev["cmd_id"] == "c1", "cmd_id не вернулся"
        assert ev["seq"] == start_seq + 1, ev
        print(f"token.added ok, seq={ev['seq']}")

        # Игрок тоже должен увидеть это событие
        ev2 = await recv_until(player, lambda m: m.get("name") == "token.added")
        assert ev2["payload"]["token"]["id"] == token_id
        print("рассылка второму клиенту ok")

        # 2. Поставить стену между (200,0) и (200,400)
        await gm.send(json.dumps({
            "type": "cmd", "id": "c2", "name": "wall.add",
            "payload": {"x1": 200, "y1": 0, "x2": 200, "y2": 400},
        }))
        await recv_until(gm, lambda m: m.get("name") == "wall.added")
        await recv_until(player, lambda m: m.get("name") == "wall.added")
        print("wall.added ok")

        # 3. Движение сквозь стену должно быть отклонено
        await player.send(json.dumps({
            "type": "cmd", "id": "c3", "name": "token.move",
            "payload": {"id": token_id, "x": 300, "y": 100},
        }))
        err = await recv_until(player, lambda m: m.get("type") == "error")
        assert err["cmd_id"] == "c3", err
        print(f"движение сквозь стену отклонено: {err['message']}")

        # 4. Движение вдоль стены должно пройти
        await player.send(json.dumps({
            "type": "cmd", "id": "c4", "name": "token.move",
            "payload": {"id": token_id, "x": 150, "y": 250},
        }))
        ev = await recv_until(player, lambda m: m.get("name") == "token.moved")
        assert ev["payload"]["x"] == 150
        print("легальное движение ok")

        # 5. Бросок кубов на сервере
        await gm.send(json.dumps({
            "type": "cmd", "id": "c5", "name": "chat.say",
            "payload": {"text": "/r 4d6kh3+2"},
        }))
        ev = await recv_until(gm, lambda m: m.get("name") == "chat.said")
        roll = ev["payload"]["message"]["roll"]
        assert roll is not None, "бросок не распознан"
        dice_term = roll["terms"][0]
        assert len(dice_term["rolls"]) == 4 and len(dice_term["kept"]) == 3
        assert roll["total"] == sum(dice_term["kept"]) + 2
        print(f"бросок ok: {roll['formula']} -> {roll['total']} "
              f"(кубы {dice_term['rolls']}, оставлено {dice_term['kept']})")

        # 6. Мусорная команда не роняет соединение
        await gm.send(json.dumps({"type": "cmd", "id": "c6", "name": "nope.nope", "payload": {}}))
        err = await recv_until(gm, lambda m: m.get("type") == "error")
        print(f"неизвестная команда отклонена: {err['message']}")

    print("\nвсе проверки прошли")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

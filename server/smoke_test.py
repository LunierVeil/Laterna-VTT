"""Дымовой тест бэкенда. Запускать при живом сервере на :8000.

    python server/smoke_test.py

Проверяет то, что сломать проще всего: порядок seq, подтверждение
команды по cmd_id, блокировку движения стеной, серверный бросок и то,
что скрытая сцена не утекает игроку.

Ключ ГМ берётся из LANTERNA_GM_KEY или из server/gm_key.txt.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import httpx
import websockets


BASE = "http://127.0.0.1:8000"
WS = "ws://127.0.0.1:8000"


def gm_cookie() -> str:
    key = os.getenv("LANTERNA_GM_KEY") or (Path(__file__).parent / "gm_key.txt").read_text().strip()
    return f"lanterna_gm={key}"


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

    # Стены ставит только ГМ, поэтому первый клиент - с ключом.
    cookie = {"Cookie": gm_cookie()}
    async with websockets.connect(f"{WS}/ws/scene/{scene_id}?user=gm", additional_headers=cookie) as gm, \
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

        # 2б. Игрок стену не ставит
        await player.send(json.dumps({
            "type": "cmd", "id": "c2b", "name": "wall.add",
            "payload": {"x1": 0, "y1": 500, "x2": 100, "y2": 500},
        }))
        err = await recv_until(player, lambda m: m.get("type") == "error")
        assert err["cmd_id"] == "c2b", err
        print(f"игрок стену не ставит: {err['message']}")

        # 3. Движение сквозь стену должно быть отклонено (двигает владелец)
        await gm.send(json.dumps({
            "type": "cmd", "id": "c3", "name": "token.move",
            "payload": {"id": token_id, "x": 300, "y": 100},
        }))
        err = await recv_until(gm, lambda m: m.get("type") == "error")
        assert err["cmd_id"] == "c3", err
        assert "стена" in err["message"], err
        print(f"движение сквозь стену отклонено: {err['message']}")

        # 4. Движение вдоль стены должно пройти, и его видит второй клиент
        await gm.send(json.dumps({
            "type": "cmd", "id": "c4", "name": "token.move",
            "payload": {"id": token_id, "x": 150, "y": 250},
        }))
        ev = await recv_until(player, lambda m: m.get("name") == "token.moved")
        assert ev["payload"]["x"] == 150
        print("легальное движение ok")

        # 4б. Чужой токен игрок не двигает
        await player.send(json.dumps({
            "type": "cmd", "id": "c4b", "name": "token.move",
            "payload": {"id": token_id, "x": 150, "y": 320},
        }))
        err = await recv_until(player, lambda m: m.get("type") == "error")
        assert err["cmd_id"] == "c4b", err
        print(f"чужой токен не двигается: {err['message']}")

        # 5. Бросок кубов на сервере
        await gm.send(json.dumps({
            "type": "cmd", "id": "c5", "name": "chat.say",
            "payload": {"text": "/r 4d6kh3+2"},
        }))
        ev = await recv_until(gm, lambda m: m.get("type") == "chat")
        roll = ev["message"]["roll"]
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

    # 7. Скрытая сцена: ГМ создаёт, игрок не может до неё добраться.
    # Активацию не проверяем: тест гоняют на живом сервере, она бы
    # перекинула настоящих игроков.
    async with websockets.connect(f"{WS}/ws/scene/{scene_id}?user=gm", additional_headers=cookie) as gm:
        snap = json.loads(await gm.recv())
        assert snap["you"]["is_gm"], "ключ ГМ не принят"
        await gm.send(json.dumps({
            "type": "cmd", "id": "c7", "name": "scene.create", "payload": {"name": "smoke: скрытая"},
        }))
        hidden_id = (await recv_until(gm, lambda m: m.get("type") == "reply"))["payload"]["id"]
        try:
            async with websockets.connect(f"{WS}/ws/scene/{hidden_id}?user=player") as player:
                first = json.loads(await player.recv())
                assert first["type"] == "campaign" and "scenes" not in first, first
                assert first["active_scene_id"] != hidden_id
            async with httpx.AsyncClient() as client:
                r = await client.get(f"{BASE}/api/scenes/{hidden_id}")
                assert r.status_code == 404, r.status_code
                names = [s["id"] for s in (await client.get(f"{BASE}/api/scenes")).json()]
                assert hidden_id not in names, "скрытая сцена в списке игрока"
            print("скрытая сцена игроку недоступна")
        finally:
            await gm.send(json.dumps({
                "type": "cmd", "id": "c8", "name": "scene.delete", "payload": {"id": hidden_id},
            }))
            await recv_until(gm, lambda m: m.get("type") == "reply")

    print("\nвсе проверки прошли")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

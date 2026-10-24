"""Дымовой тест бэкенда. Запускать при живом сервере на :8000.

    python server/smoke_test.py

Проверяет то, что сломать проще всего: вход и сессии, порядок seq,
подтверждение команды по cmd_id, блокировку движения стеной, серверный
бросок и то, что скрытая сцена не утекает игроку.

ГМ входит по ключу (LANTERNA_GM_KEY или server/gm_key.txt). Аккаунт
мастера тест не создаёт - иначе на свежем сервере пароль мастера стал бы
паролем из теста. Игрока тест заводит по приглашению и в конце удаляет.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import secrets
import sqlite3
import sys
from pathlib import Path

import httpx
import websockets


BASE = "http://127.0.0.1:8000"
WS = "ws://127.0.0.1:8000"


SESSION = "lanterna_session"


def gm_key() -> str:
    return os.getenv("LANTERNA_GM_KEY") or (Path(__file__).parent / "gm_key.txt").read_text().strip()


def session_header(response: httpx.Response) -> dict:
    return {"Cookie": f"{SESSION}={response.cookies[SESSION]}"}


def sqlite_path() -> Path | None:
    """База сервера, если это SQLite (как у сервера: DATABASE_URL или ./lanterna.db)."""
    url = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./lanterna.db")
    if not url.startswith("sqlite"):
        return None
    path = Path(url.split("///", 1)[1])
    return path if path.is_absolute() else Path(__file__).parent / path


async def cmd(ws, cmd_id: str, name: str, payload: dict) -> None:
    await ws.send(json.dumps({"type": "cmd", "id": cmd_id, "name": name, "payload": payload}))


async def recv_until(ws, predicate, timeout=5.0):
    async def _loop():
        while True:
            msg = json.loads(await ws.recv())
            if predicate(msg):
                return msg

    return await asyncio.wait_for(_loop(), timeout)


async def main() -> int:
    async with httpx.AsyncClient() as client:
        # 0. Без входа - ни REST, ни сокет
        assert (await client.get(f"{BASE}/api/campaign")).status_code == 401
        r = await client.post(f"{BASE}/api/gm/login", json={"key": gm_key()})
        if r.status_code == 403:
            print("ключ ГМ не подошёл")
            return 1
        if r.json().get("needs_setup"):
            print("на сервере ещё нет аккаунта мастера - создай его по ссылке из ./dev.sh gm")
            return 1
        gm_auth = session_header(r)
        scene_id = (await client.get(f"{BASE}/api/campaign", headers=gm_auth)).json()["active_scene_id"]
    print(f"сцена {scene_id}, ГМ вошёл по ключу")

    async with websockets.connect(f"{WS}/ws/scene/{scene_id}") as anon:
        assert json.loads(await anon.recv())["type"] == "auth_required"
    print("без входа сокет не пускает")

    # Временный игрок по приглашению: ГМ даёт ссылку, игрок сам задаёт
    # имя и пароль.
    player_name = f"smoke-{secrets.token_hex(3)}"
    password = secrets.token_urlsafe(12)

    async def invite(payload: dict) -> str:
        async with websockets.connect(f"{WS}/ws/scene/{scene_id}", additional_headers=gm_auth) as gm:
            await cmd(gm, "inv", "invite.create", payload)
            return (await recv_until(gm, lambda m: m.get("type") == "reply"))["payload"]["token"]

    token = await invite({})
    async with httpx.AsyncClient() as client:
        info = (await client.post(f"{BASE}/api/invite/info", json={"token": token})).json()
        assert info == {"kind": "join"}, info
        r = await client.post(
            f"{BASE}/api/invite/accept", json={"token": token, "name": player_name, "password": password}
        )
        assert r.status_code == 200, r.text
        player_id = r.json()["id"]
        old_auth = session_header(r)
        again = await client.post(
            f"{BASE}/api/invite/accept", json={"token": token, "name": "x", "password": password}
        )
        assert again.status_code == 404, "приглашение сработало дважды"
        bad = await client.post(f"{BASE}/api/login", json={"name": player_name, "password": "wrong-pass"})
        assert bad.status_code == 401, bad.status_code
        r = await client.post(f"{BASE}/api/login", json={"name": player_name, "password": password})
        assert r.status_code == 200, r.text
    print(f"игрок {player_name} создан по приглашению, ссылка одноразовая, вход ok")

    # Сброс пароля по ссылке: старая сессия перестаёт действовать.
    token = await invite({"user_id": player_id})
    password = secrets.token_urlsafe(12)
    async with httpx.AsyncClient() as client:
        info = (await client.post(f"{BASE}/api/invite/info", json={"token": token})).json()
        assert info == {"kind": "reset", "name": player_name}, info
        r = await client.post(f"{BASE}/api/invite/accept", json={"token": token, "password": password})
        assert r.status_code == 200, r.text
        assert (await client.get(f"{BASE}/api/me", headers=old_auth)).json() is None, "старая сессия жива"
        player_auth = session_header(r)
    print("сброс пароля по ссылке: старая сессия закрыта, новый пароль подходит")

    # Просроченная сессия. Месяц ждать тест не может, поэтому старит свою
    # же свежую сессию прямо в базе. Не SQLite (Postgres в docker) - пропуск.
    db_path = sqlite_path()
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{BASE}/api/login", json={"name": player_name, "password": password})
        token = r.cookies[SESSION]
        if db_path and db_path.is_file():
            digest = hashlib.sha256(token.encode()).hexdigest()
            with sqlite3.connect(db_path) as db:
                db.execute(
                    "UPDATE sessions SET created_at = '2000-01-01 00:00:00.000000' WHERE token_hash = ?",
                    (digest,),
                )
            assert (await client.get(f"{BASE}/api/me", headers=session_header(r))).json() is None
            with sqlite3.connect(db_path) as db:
                left = db.execute("SELECT count(*) FROM sessions WHERE token_hash = ?", (digest,)).fetchone()[0]
            assert left == 0, "просроченная сессия не удалена"
            print("просроченная сессия не пускает и удаляется")
        else:
            print("просроченная сессия: пропущено (база не SQLite или не найдена)")

    # Websocket с чужого сайта - отказ; со своего адреса - пускает.
    try:
        async with websockets.connect(
            f"{WS}/ws/scene/{scene_id}", additional_headers=player_auth, origin="http://evil.example"
        ):
            raise AssertionError("сокет с чужим Origin пустили")
    except websockets.exceptions.InvalidStatus as exc:
        assert exc.response.status_code == 403, exc.response.status_code
    async with websockets.connect(
        f"{WS}/ws/scene/{scene_id}", additional_headers=player_auth, origin=BASE
    ) as ws:
        assert json.loads(await ws.recv())["type"] == "snapshot"
    print("чужой Origin - отказ, свой - пускает")

    # Выход закрывает сокеты этой сессии, но не другие входы игрока.
    async with httpx.AsyncClient() as client:
        a = session_header(await client.post(f"{BASE}/api/login", json={"name": player_name, "password": password}))
        b = session_header(await client.post(f"{BASE}/api/login", json={"name": player_name, "password": password}))
    async with websockets.connect(f"{WS}/ws/scene/{scene_id}", additional_headers=a) as wa, \
            websockets.connect(f"{WS}/ws/scene/{scene_id}", additional_headers=b) as wb:
        await wa.recv()
        await wb.recv()
        async with httpx.AsyncClient() as client:
            await client.post(f"{BASE}/api/logout", headers=a)
        await recv_until(wa, lambda m: m.get("type") == "auth_required")
        async with httpx.AsyncClient() as client:
            assert (await client.get(f"{BASE}/api/me", headers=b)).json() is not None, "задело другой вход"
    print("выход закрыл сокет своей сессии, другой вход жив")

    # Лист персонажа: игрок видит и правит только свой, ГМ - любой.
    async with websockets.connect(f"{WS}/ws/scene/{scene_id}", additional_headers=gm_auth) as gm, \
            websockets.connect(f"{WS}/ws/scene/{scene_id}", additional_headers=player_auth) as pl:
        await cmd(gm, "ch1", "character.create", {"name": "smoke: лист ГМ"})
        char_id = (await recv_until(gm, lambda m: m.get("type") == "reply"))["payload"]["character"]["id"]
        try:
            await cmd(pl, "ch2", "character.update", {"id": char_id, "set": {"vitals.hp.current": 1}})
            err = await recv_until(pl, lambda m: m.get("type") == "error")
            assert "нет такого" in err["message"], err
            async with httpx.AsyncClient(headers=player_auth) as client:
                ids = [c["id"] for c in (await client.get(f"{BASE}/api/characters")).json()]
            assert char_id not in ids, "игрок видит чужой лист"
            await cmd(gm, "ch3", "character.update", {"id": char_id, "set": {"vitals.hp.current": 7}})
            # Первым мог прийти лист сразу после создания - ждём именно правку.
            saved = await recv_until(
                gm, lambda m: m.get("type") == "character" and "vitals" in m["character"]["data"]
            )
            assert saved["character"]["data"]["vitals"]["hp"]["current"] == 7, saved
        finally:
            await cmd(gm, "ch4", "character.delete", {"id": char_id})
            await recv_until(gm, lambda m: m.get("type") == "character_deleted")
    print("чужой лист игрок не видит и не правит, ГМ правит")

    try:
        return await scene_checks(scene_id, gm_auth, player_auth)
    finally:
        async with websockets.connect(f"{WS}/ws/scene/{scene_id}", additional_headers=gm_auth) as gm:
            await cmd(gm, "p2", "player.delete", {"id": player_id})
            await recv_until(gm, lambda m: m.get("type") == "reply")


async def scene_checks(scene_id: str, gm_auth: dict, player_auth: dict) -> int:
    async with websockets.connect(f"{WS}/ws/scene/{scene_id}", additional_headers=gm_auth) as gm, \
            websockets.connect(f"{WS}/ws/scene/{scene_id}", additional_headers=player_auth) as player:

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

        # 5б. Бросок из листа: формула и подпись, число - на сервере
        await gm.send(json.dumps({
            "type": "cmd", "id": "c5b", "name": "dice.roll",
            "payload": {"formula": "1d20+10", "label": "Цеп - атака"},
        }))
        ev = await recv_until(gm, lambda m: m.get("type") == "chat")
        roll = ev["message"]["roll"]
        assert roll["label"] == "Цеп - атака" and roll["formula"] == "1d20+10", roll
        assert roll["total"] == roll["terms"][0]["value"] + 10, roll
        await gm.send(json.dumps({
            "type": "cmd", "id": "c5c", "name": "dice.roll", "payload": {"formula": "1d20; DROP", "label": "x"},
        }))
        err = await recv_until(gm, lambda m: m.get("type") == "error")
        assert err["cmd_id"] == "c5c", err
        print(f"бросок из листа ok: {roll['label']} = {roll['total']}, мусорная формула отклонена")

        # 6. Мусорная команда не роняет соединение
        await gm.send(json.dumps({"type": "cmd", "id": "c6", "name": "nope.nope", "payload": {}}))
        err = await recv_until(gm, lambda m: m.get("type") == "error")
        print(f"неизвестная команда отклонена: {err['message']}")

    # 7. Скрытая сцена: ГМ создаёт, игрок не может до неё добраться.
    # Активацию не проверяем: тест гоняют на живом сервере, она бы
    # перекинула настоящих игроков.
    async with websockets.connect(f"{WS}/ws/scene/{scene_id}", additional_headers=gm_auth) as gm:
        snap = json.loads(await gm.recv())
        assert snap["you"]["is_gm"], "сессия ГМ не принята"
        await gm.send(json.dumps({
            "type": "cmd", "id": "c7", "name": "scene.create", "payload": {"name": "smoke: скрытая"},
        }))
        hidden_id = (await recv_until(gm, lambda m: m.get("type") == "reply"))["payload"]["id"]
        try:
            async with websockets.connect(f"{WS}/ws/scene/{hidden_id}", additional_headers=player_auth) as player:
                first = json.loads(await player.recv())
                assert first["type"] == "campaign" and "scenes" not in first, first
                assert first["active_scene_id"] != hidden_id
            async with httpx.AsyncClient(headers=player_auth) as client:
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

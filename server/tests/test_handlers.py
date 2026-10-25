"""Команды сервера через настоящий websocket, без живого процесса.

pytest tests/ - приложение поднимается на временной SQLite (conftest.py).
Проверяется то, что сломать проще всего и что не видно в интерфейсе:
права, утечки игрокам, мусор в числах.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

# Временную базу подставляет conftest.py - его грузит pytest. Запуск без
# него (unittest, импорт руками) писал бы в настоящую базу мастера.
if "laterna-tests-" not in os.environ.get("DATABASE_URL", ""):
    raise RuntimeError("tests/test_handlers.py запускается через pytest (нужен conftest.py)")

from app import auth, handlers, main
from app.main import app

GM_KEY = os.environ["LANTERNA_GM_KEY"]  # задаёт conftest.py


def recv_until(ws, pred, limit=50):
    for _ in range(limit):
        msg = ws.receive_json()
        if pred(msg):
            return msg
    raise AssertionError("ожидаемое сообщение не пришло")


def run(ws, cid: str, name: str, payload: dict) -> dict:
    """Команда и ответ на неё (событие или ошибка с тем же cmd_id)."""
    # json.dumps пишет inf как Infinity - ровно так их пришлёт и браузер-злоумышленник.
    ws.send_text(json.dumps({"type": "cmd", "id": cid, "name": name, "payload": payload}))
    return recv_until(ws, lambda m: m.get("cmd_id") == cid)


# Один TestClient на всё: у каждого клиента свой цикл событий, а движок базы
# общий - соединения двух циклов блокировали SQLite. ГМ и игрок отличаются
# cookie сессии в заголовке, банка cookie клиента остаётся пустой.
@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def session_headers(client: TestClient, response) -> dict:
    assert response.status_code == 200, response.text
    token = response.cookies[auth.SESSION_COOKIE]
    client.cookies.clear()
    return {"cookie": f"{auth.SESSION_COOKIE}={token}"}


@pytest.fixture(scope="module")
def gm(client) -> dict:
    r = client.post("/api/gm/login", json={"key": GM_KEY, "name": "Мастер", "password": "masterpass1"})
    return session_headers(client, r)


@pytest.fixture(scope="module")
def scene_id(client, gm) -> str:
    return client.get("/api/campaign", headers=gm).json()["active_scene_id"]


@pytest.fixture(scope="module")
def player(client, gm, scene_id) -> dict:
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as ws:
        ws.receive_json()
        ws.send_text(json.dumps({"type": "cmd", "id": "inv", "name": "invite.create", "payload": {}}))
        token = recv_until(ws, lambda m: m.get("type") == "reply")["payload"]["token"]
        # После ответа сервер рассылает список кампании - ещё в сессии базы.
        # Закрыть сокет раньше - TestClient оборвёт обработчик с открытым
        # чтением, и следующая запись упрётся в "database is locked".
        recv_until(ws, lambda m: m.get("type") == "campaign")
    r = client.post("/api/invite/accept", json={"token": token, "name": "Игрок", "password": "playerpass1"})
    headers = session_headers(client, r)
    headers_id = r.json()["id"]
    return {"headers": headers, "id": headers_id}


@pytest.fixture
def sockets(client, gm, player, scene_id):
    """Сокеты ГМ и игрока на одной сцене, снапшоты уже прочитаны."""
    with client.websocket_connect(f"/ws/scene/{scene_id}", headers=gm) as g, client.websocket_connect(
        f"/ws/scene/{scene_id}", headers=player["headers"]
    ) as p:
        assert g.receive_json()["type"] == "snapshot"
        assert p.receive_json()["type"] == "snapshot"
        yield g, p


def is_event(m: dict) -> bool:
    return m.get("type") == "event"


# --- двери ------------------------------------------------------------------


def test_doors(sockets):
    g, p = sockets
    door = run(g, "d1", "wall.add", {"x1": 280, "y1": 560, "x2": 280, "y2": 630, "kind": "door"})["payload"]["wall"]
    tok = run(p, "d2", "token.add", {"x": 245, "y": 595})["payload"]["token"]
    try:
        # Закрытая дверь - стена.
        assert run(p, "d3", "token.move", {"id": tok["id"], "x": 315, "y": 595})["type"] == "error"
        # Открыть может игрок, и тогда проход есть.
        assert run(p, "d4", "wall.door", {"id": door["id"], "state": "open"})["type"] == "event"
        assert run(p, "d5", "token.move", {"id": tok["id"], "x": 315, "y": 595})["type"] == "event"
        assert run(p, "d6", "token.move", {"id": tok["id"], "x": 245, "y": 595})["type"] == "event"
        # Запертую игрок не отпирает и сам не запирает.
        assert run(g, "d7", "wall.door", {"id": door["id"], "state": "locked"})["type"] == "event"
        err = run(p, "d8", "wall.door", {"id": door["id"], "state": "open"})
        assert err["type"] == "error" and "заперта" in err["message"]
        assert run(p, "d9", "token.move", {"id": tok["id"], "x": 315, "y": 595})["type"] == "error"
        assert run(g, "d10", "wall.door", {"id": door["id"], "state": "closed"})["type"] == "event"
        assert run(p, "d11", "wall.door", {"id": door["id"], "state": "locked"})["type"] == "error"
    finally:
        run(p, "d12", "token.remove", {"id": tok["id"]})
        run(g, "d13", "wall.remove", {"id": door["id"]})


# --- скрытый бросок ---------------------------------------------------------


def test_hidden_roll(sockets):
    g, p = sockets
    g.send_text(json.dumps({"type": "cmd", "id": "r1", "name": "chat.say", "payload": {"text": "/gr 1d20+7"}}))
    got_g = recv_until(g, lambda m: m.get("type") == "chat")
    got_p = recv_until(p, lambda m: m.get("type") == "chat")
    assert got_g["message"]["roll"]["hidden"] and got_g["message"]["roll"]["formula"] == "1d20+7"
    msg = got_p["message"]
    assert msg["kind"] == "hidden_roll" and msg["roll"] is None and msg["text"] == ""
    # Ни формулы, ни итога - нигде в сообщении.
    raw = json.dumps(got_p)
    assert "1d20" not in raw and f'"total": {got_g["message"]["roll"]["total"]}' not in raw

    err = run(p, "r2", "chat.say", {"text": "/gr 1d20"})
    assert err["type"] == "error"
    err = run(p, "r3", "dice.roll", {"formula": "1d20", "hidden": True})
    assert err["type"] == "error"


# --- хиты моба --------------------------------------------------------------


def test_mob_hp_visibility(sockets, player):
    g, p = sockets
    g.send_text(json.dumps({"type": "cmd", "id": "m1", "name": "character.create", "payload": {"name": "Гоблин", "system": "mob"}}))
    mob = recv_until(g, lambda m: m.get("cmd_id") == "m1")["payload"]["character"]
    g.send_text(json.dumps({"type": "cmd", "id": "m2", "name": "character.update", "payload": {"id": mob["id"], "set": {"hp.max": 7}}}))
    recv_until(g, lambda m: m.get("type") == "character")
    try:
        ev = run(g, "m3", "token.add", {"x": 455, "y": 175, "character_id": mob["id"]})
        tok = ev["payload"]["token"]
        assert tok["hp"] == 7, "ГМ видит хиты экземпляра"
        seen = recv_until(p, lambda m: m.get("name") == "token.added")
        assert seen["payload"]["token"]["hp"] is None, "игроку хиты моба не уходят"

        # Отдали токен игроку - теперь он владелец и видит число.
        ev = run(g, "m4", "token.update", {"id": tok["id"], "owner_id": player["id"]})
        assert ev["payload"]["token"]["hp"] == 7
        seen = recv_until(p, lambda m: m.get("name") == "token.updated")
        assert seen["payload"]["token"]["hp"] == 7, "владелец токена видит хиты"
    finally:
        run(g, "m5", "token.remove", {"id": tok["id"]})
        g.send_text(json.dumps({"type": "cmd", "id": "m6", "name": "character.delete", "payload": {"id": mob["id"]}}))
        recv_until(g, lambda m: m.get("type") == "character_deleted")


# --- конечные числа ---------------------------------------------------------


def test_infinite_wall_rejected_and_scene_still_loads(client, gm, sockets, scene_id):
    g, _ = sockets
    for bad in (float("inf"), float("-inf"), float("nan")):
        err = run(g, "n1", "wall.add", {"x1": bad, "y1": 0, "x2": 100, "y2": 100})
        assert err["type"] == "error", err
    # Снапшот сцены сериализуется: inf в базе ронял бы его с 500 для всех.
    r = client.get(f"/api/scenes/{scene_id}", headers=gm)
    assert r.status_code == 200
    assert all(abs(w["x1"]) < 1e9 for w in r.json()["walls"])


def test_wall_clamped_to_scene(client, gm, sockets, scene_id):
    g, _ = sockets
    wall = run(g, "n2", "wall.add", {"x1": -500, "y1": 10, "x2": 10**9, "y2": 10})["payload"]["wall"]
    try:
        scene = client.get(f"/api/scenes/{scene_id}", headers=gm).json()
        assert wall["x1"] == 0 and wall["x2"] == scene["width"]
    finally:
        run(g, "n3", "wall.remove", {"id": wall["id"]})


@pytest.mark.parametrize(
    "name,payload",
    [
        ("token.add", {"x": 10, "y": 10, "size": float("inf")}),
        ("token.add", {"x": float("nan"), "y": 10}),
        ("scene.update", {"grid_size": float("inf")}),
        ("scene.update", {"width": float("nan")}),
        ("scene.update", {"height": "1e400"}),
    ],
)
def test_non_finite_numbers_rejected(sockets, name, payload):
    g, _ = sockets
    err = run(g, "n4", name, payload)
    assert err["type"] == "error", err


def test_combat_numbers_rejected(sockets):
    g, _ = sockets
    tok = run(g, "c1", "token.add", {"x": 35, "y": 35})["payload"]["token"]
    try:
        ev = run(g, "c2", "combat.add", {"token_id": tok["id"]})
        entry_id = ev["payload"]["combat"]["entries"][-1]["id"]
        assert run(g, "c3", "combat.set", {"entry_id": entry_id, "init": float("inf")})["type"] == "error"
        assert run(g, "c4", "combat.roll", {"entry_id": entry_id, "bonus": float("nan")})["type"] == "error"
    finally:
        run(g, "c5", "combat.end", {})
        run(g, "c6", "token.remove", {"id": tok["id"]})


def test_hp_inf_is_error_and_socket_survives(sockets):
    g, _ = sockets
    g.send_text(json.dumps({"type": "cmd", "id": "h1", "name": "character.create", "payload": {"name": "Волк", "system": "mob"}}))
    mob = recv_until(g, lambda m: m.get("cmd_id") == "h1")["payload"]["character"]
    tok = run(g, "h2", "token.add", {"x": 105, "y": 105, "character_id": mob["id"]})["payload"]["token"]
    try:
        for bad in (float("inf"), float("nan"), 2.5, True):
            err = run(g, "h3", "token.update", {"id": tok["id"], "hp": bad})
            assert err["type"] == "error", (bad, err)
        # Тот же сокет жив и принимает команды.
        g.send_text(json.dumps({"type": "cmd", "id": "h4", "name": "chat.say", "payload": {"text": "жив"}}))
        assert recv_until(g, lambda m: m.get("type") == "chat")["message"]["text"] == "жив"
    finally:
        run(g, "h5", "token.remove", {"id": tok["id"]})
        g.send_text(json.dumps({"type": "cmd", "id": "h6", "name": "character.delete", "payload": {"id": mob["id"]}}))
        recv_until(g, lambda m: m.get("type") == "character_deleted")


def test_internal_error_keeps_socket(sockets, monkeypatch):
    """Упал сам хендлер (не CommandError) - ответ "внутренняя ошибка", сокет жив."""
    g, _ = sockets

    async def broken(*args, **kwargs):
        raise RuntimeError("сломалось")

    monkeypatch.setitem(main.HANDLERS, "token.add", broken)
    monkeypatch.setitem(main.CAMPAIGN_HANDLERS, "dice.roll", broken)
    err = run(g, "e1", "token.add", {"x": 1, "y": 1})
    assert err["type"] == "error" and err["message"] == "внутренняя ошибка"
    err = run(g, "e2", "dice.roll", {"formula": "1d6"})
    assert err["type"] == "error" and err["message"] == "внутренняя ошибка"
    g.send_text(json.dumps({"type": "cmd", "id": "e3", "name": "chat.say", "payload": {"text": "после ошибки"}}))
    assert recv_until(g, lambda m: m.get("type") == "chat")["message"]["text"] == "после ошибки"


def test_as_num_helpers():
    for bad in (float("inf"), float("nan"), "nan", "1e400", True, None, "abc", [1]):
        with pytest.raises(handlers.CommandError):
            handlers._as_num(bad, "x")
    assert handlers._as_num("12.5", "x") == 12.5
    assert handlers._int({"v": 7.9}, "v", 0, 5) == 5


# --- ограничение попыток входа ----------------------------------------------


def test_login_rate_limit(client, player):
    for _ in range(main.LOGIN_MAX_FAILURES):
        assert client.post("/api/login", json={"name": "Игрок", "password": "wrong-pass"}).status_code == 401
    r = client.post("/api/login", json={"name": "Игрок", "password": "playerpass1"})
    assert r.status_code == 429 and int(r.headers["retry-after"]) > 0
    # Другое имя с того же адреса - пока можно (лимит по адресу мягче).
    assert client.post("/api/login", json={"name": "Кто-то", "password": "wrong-pass"}).status_code == 401
    main.login_limiter.reset("testclient|игрок")
    # Успешный вход сбрасывает счётчик неудач.
    assert client.post("/api/login", json={"name": "Игрок", "password": "wrong-pass"}).status_code == 401
    assert client.post("/api/login", json={"name": "Игрок", "password": "playerpass1"}).status_code == 200
    client.cookies.clear()
    assert main.login_limiter.retry_after("testclient|игрок") is None


def test_gm_key_rate_limit(client, gm):
    for _ in range(main.LOGIN_MAX_FAILURES):
        assert client.post("/api/gm/login", json={"key": "nope"}).status_code == 403
    r = client.post("/api/gm/login", json={"key": GM_KEY})
    assert r.status_code == 429 and "retry-after" in r.headers
    main.login_limiter.reset("testclient|ключ ГМ")
    main.ip_limiter.reset("testclient")


def test_forwarded_for_only_when_trusted(monkeypatch):
    def req(host, xff=None):
        return SimpleNamespace(client=SimpleNamespace(host=host), headers={"x-forwarded-for": xff} if xff else {})

    monkeypatch.setattr(main, "TRUST_PROXY", False)
    assert main.client_ip(req("127.0.0.1", "1.2.3.4")) == "127.0.0.1"
    monkeypatch.setattr(main, "TRUST_PROXY", True)
    # Последний адрес дописал прокси; левее - что прислал клиент.
    assert main.client_ip(req("127.0.0.1", "6.6.6.6, 1.2.3.4")) == "1.2.3.4"
    # Не с этой машины - заголовку не верим даже при включённой настройке.
    assert main.client_ip(req("10.0.0.5", "1.2.3.4")) == "10.0.0.5"


# --- переимпорт LSS ----------------------------------------------------------


def test_reimport_keeps_player_text(sockets):
    g, _ = sockets
    source = (Path(__file__).parent / "fixtures" / "lss_sample.json").read_text(encoding="utf-8")
    g.send_text(json.dumps({"type": "cmd", "id": "i1", "name": "character.import", "payload": {"source": source}}))
    reply = recv_until(g, lambda m: m.get("cmd_id") == "i1")
    char = reply["payload"]["character"]
    assert reply["payload"]["report"]["done"], "отчёт импорта - в ответе"
    try:
        g.send_text(json.dumps({"type": "cmd", "id": "i2", "name": "character.update", "payload": {
            "id": char["id"], "set": {"about.story": "своя история", "skills.athletics.bonus": 13},
        }}))
        recv_until(g, lambda m: m.get("type") == "character")
        g.send_text(json.dumps({"type": "cmd", "id": "i3", "name": "character.reimport", "payload": {"id": char["id"]}}))
        data = recv_until(g, lambda m: m.get("type") == "character")["character"]["data"]
        assert data["about"]["story"] == "своя история"
        assert data["skills"]["athletics"]["bonus"] == 13
        assert any(c["id"] == "lss-allies" for c in data["lore"])  # в образце из личных текстов заполнены союзники
    finally:
        g.send_text(json.dumps({"type": "cmd", "id": "i4", "name": "character.delete", "payload": {"id": char["id"]}}))
        recv_until(g, lambda m: m.get("type") == "character_deleted")
